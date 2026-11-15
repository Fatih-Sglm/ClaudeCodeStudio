using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using ClaudeStudioAgent;
using Xunit;

namespace ClaudeStudioTests;

public class AgentSocketServerTests
{
    private static async Task<ClientWebSocket> ConnectAsync(AgentSocketServer server, string? origin = "null")
    {
        var ws = new ClientWebSocket();
        if (origin != null) ws.Options.SetRequestHeader("Origin", origin);
        // ClientWebSocket validates Sec-WebSocket-Accept itself, so a successful
        // connect also proves the RFC 6455 accept computation.
        await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{server.Port}/"), TestContext.Current.CancellationToken);
        return ws;
    }

    private static Task SendAsync(ClientWebSocket ws, string json) =>
        ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, TestContext.Current.CancellationToken);

    // Text of the next message, or null when the server dropped/closed the connection.
    private static async Task<string?> ReceiveAsync(ClientWebSocket ws, int timeoutMs = 5000)
    {
        var buf = new byte[4096];
        using var cts = new CancellationTokenSource(timeoutMs);
        try
        {
            var r = await ws.ReceiveAsync(buf, cts.Token);
            return r.MessageType == WebSocketMessageType.Close ? null : Encoding.UTF8.GetString(buf, 0, r.Count);
        }
        catch (WebSocketException) { return null; }
    }

    [Fact]
    public async Task ValidToken_GetsHelloAndPong()
    {
        using var server = new AgentSocketServer();
        using var ws = await ConnectAsync(server);
        await SendAsync(ws, $"{{\"type\":\"auth\",\"token\":\"{server.Token}\"}}");
        Assert.Equal("{\"type\":\"ws-hello\"}", await ReceiveAsync(ws));
        await SendAsync(ws, "{\"type\":\"ping\"}");
        Assert.Equal("{\"type\":\"pong\"}", await ReceiveAsync(ws));
    }

    [Fact]
    public async Task FileOrigin_IsAccepted()
    {
        using var server = new AgentSocketServer();
        using var ws = await ConnectAsync(server, "file://");
        await SendAsync(ws, $"{{\"type\":\"auth\",\"token\":\"{server.Token}\"}}");
        Assert.Equal("{\"type\":\"ws-hello\"}", await ReceiveAsync(ws));
    }

    [Theory]
    [InlineData("{\"type\":\"auth\",\"token\":\"wrong\"}")]
    [InlineData("{\"type\":\"auth\"}")]
    [InlineData("{\"type\":\"ping\"}")]
    [InlineData("not json")]
    public async Task BadAuth_IsDroppedWithoutAnyData(string firstMessage)
    {
        using var server = new AgentSocketServer();
        using var ws = await ConnectAsync(server);
        await SendAsync(ws, firstMessage);
        Assert.Null(await ReceiveAsync(ws));
    }

    [Fact]
    public async Task TokenOffByOneChar_IsRejected()
    {
        using var server = new AgentSocketServer();
        using var ws = await ConnectAsync(server);
        var t = server.Token;
        var wrong = t[..^1] + (t[^1] == 'A' ? 'B' : 'A');
        await SendAsync(ws, $"{{\"type\":\"auth\",\"token\":\"{wrong}\"}}");
        Assert.Null(await ReceiveAsync(ws));
    }

    [Fact]
    public async Task NoAuth_IsDroppedAfterTimeoutWithoutAnyData()
    {
        using var server = new AgentSocketServer();
        using var ws = await ConnectAsync(server);
        var sw = Stopwatch.StartNew();
        Assert.Null(await ReceiveAsync(ws, timeoutMs: 6000));
        Assert.InRange(sw.ElapsedMilliseconds, 1500, 5000);
    }

    [Fact]
    public async Task NewAuthenticatedClient_ReplacesOldOne()
    {
        using var server = new AgentSocketServer();
        using var first = await ConnectAsync(server);
        await SendAsync(first, $"{{\"type\":\"auth\",\"token\":\"{server.Token}\"}}");
        Assert.Equal("{\"type\":\"ws-hello\"}", await ReceiveAsync(first));

        using var second = await ConnectAsync(server);
        await SendAsync(second, $"{{\"type\":\"auth\",\"token\":\"{server.Token}\"}}");
        Assert.Equal("{\"type\":\"ws-hello\"}", await ReceiveAsync(second));

        Assert.Null(await ReceiveAsync(first));
    }

    // Raw requests the handshake must refuse: the connection closes with no 101.
    [Theory]
    [InlineData("POST / HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")]
    [InlineData("GET / HTTP/1.1\r\nHost: {host}\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")]
    [InlineData("GET / HTTP/1.1\r\nHost: evil.example:80\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")]
    [InlineData("GET / HTTP/1.1\r\nHost: {host}\r\nOrigin: https://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")]
    [InlineData("GET / HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: short\r\n\r\n")]
    public async Task InvalidHandshake_IsClosedWithoutUpgrade(string request)
    {
        using var server = new AgentSocketServer();
        var reply = await RawExchangeAsync(server, Encoding.ASCII.GetBytes(request.Replace("{host}", $"127.0.0.1:{server.Port}")));
        Assert.DoesNotContain("101", reply);
    }

    [Fact]
    public async Task OversizedHeader_IsClosedWithoutUpgrade()
    {
        using var server = new AgentSocketServer();
        var request = "GET / HTTP/1.1\r\nX-Pad: " + new string('a', 9000) + "\r\n\r\n";
        var reply = await RawExchangeAsync(server, Encoding.ASCII.GetBytes(request));
        Assert.DoesNotContain("101", reply);
    }

    [Fact]
    public async Task SilentClient_IsClosedAfterHeaderTimeout()
    {
        using var server = new AgentSocketServer();
        var sw = Stopwatch.StartNew();
        var reply = await RawExchangeAsync(server, Encoding.ASCII.GetBytes("GET / HTTP/1.1\r\n"));
        Assert.Equal("", reply);
        Assert.InRange(sw.ElapsedMilliseconds, 1500, 5000);
    }

    // Sends bytes, reads until the server closes; returns whatever came back.
    private static async Task<string> RawExchangeAsync(AgentSocketServer server, byte[] request)
    {
        using var tcp = new TcpClient();
        await tcp.ConnectAsync("127.0.0.1", server.Port, TestContext.Current.CancellationToken);
        var stream = tcp.GetStream();
        var sb = new StringBuilder();
        try
        {
            await stream.WriteAsync(request, TestContext.Current.CancellationToken);
            var buf = new byte[1024];
            using var cts = new CancellationTokenSource(6000);
            int n;
            while ((n = await stream.ReadAsync(buf, cts.Token)) > 0)
                sb.Append(Encoding.ASCII.GetString(buf, 0, n));
        }
        catch (IOException) { } // reset by the server — closed either way
        return sb.ToString();
    }
}
