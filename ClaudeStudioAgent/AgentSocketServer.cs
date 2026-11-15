using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ClaudeStudioAgent;

// Loopback WebSocket the webview connects to directly, so streamed output stops
// crossing Visual Studio's UI thread. Security model:
//  - TcpListener on 127.0.0.1 port 0: the OS picks the port in the same call that
//    binds it, so there is no probe-then-bind window for another local process
//    to squat the port and pose as us.
//  - A per-process 256-bit token (handed to the extension on the READY line,
//    never logged). The first client message must be {type:"auth",token} within
//    2 s; the server sends nothing before that succeeds. Constant-time compare.
//  - Host must be exactly 127.0.0.1:<port> (DNS-rebinding guard). Origin is
//    defense in depth only: file:// pages send "null", and so can any sandboxed
//    iframe — the token is the real gate.
//  - One authenticated client at a time; a newer one replaces the older.
public sealed class AgentSocketServer : IDisposable
{
    private const int MaxHeaderBytes = 8 * 1024;
    private const int MaxAuthBytes = 1024;
    private const int MaxMessageBytes = 1024 * 1024;
    private static readonly TimeSpan HandshakeTimeout = TimeSpan.FromSeconds(2);

    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly byte[] _token;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly Action<string>? _log;
    private WebSocket? _client;

    public int Port { get; }

    // Secret. Goes out once on the READY line; must never reach a log.
    public string Token { get; }

    public AgentSocketServer(Action<string>? log = null)
    {
        _log = log;
        Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        _token = Encoding.UTF8.GetBytes(Token);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = AcceptLoopAsync();
    }

    private async Task AcceptLoopAsync()
    {
        while (true)
        {
            TcpClient tcp;
            try { tcp = await _listener.AcceptTcpClientAsync(); }
            catch { return; } // listener stopped
            _ = Task.Run(() => HandleAsync(tcp));
        }
    }

    private async Task HandleAsync(TcpClient tcp)
    {
        WebSocket? ws = null;
        try
        {
            tcp.NoDelay = true;
            var stream = tcp.GetStream();

            string? key, origin;
            using (var cts = new CancellationTokenSource(HandshakeTimeout))
            {
                (key, origin) = await ReadHandshakeAsync(stream, cts.Token);
                if (key == null) return;
                var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                await stream.WriteAsync(Encoding.ASCII.GetBytes(
                    $"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"), cts.Token);
            }

            // KeepAlive off: a ping would be "sending before auth", and loopback
            // has no NAT/proxy to keep warm.
            ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, KeepAliveInterval = TimeSpan.Zero });
            if (!await AuthenticateAsync(ws)) return;

            Interlocked.Exchange(ref _client, ws)?.Abort();
            _log?.Invoke($"ws: client authenticated (origin={origin ?? "-"})");
            await SendAsync(ws, "{\"type\":\"ws-hello\"}");
            await ReceiveLoopAsync(ws);
        }
        catch (Exception ex) when (ex is IOException or SocketException or WebSocketException or OperationCanceledException or ObjectDisposedException)
        {
            // Client went away / timed out — nothing to report.
        }
        catch (Exception ex)
        {
            _log?.Invoke($"ws: connection failed: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            if (ws != null)
            {
                Interlocked.CompareExchange(ref _client, null, ws);
                ws.Dispose();
            }
            tcp.Dispose();
        }
    }

    // Returns (Sec-WebSocket-Key, Origin) for a valid upgrade request, or a null
    // key to drop the connection without a reply.
    private async Task<(string? key, string? origin)> ReadHandshakeAsync(NetworkStream stream, CancellationToken ct)
    {
        var buf = new byte[MaxHeaderBytes];
        var len = 0;
        while (true)
        {
            if (len == buf.Length) return (null, null); // header too large
            var n = await stream.ReadAsync(buf.AsMemory(len), ct);
            if (n == 0) return (null, null);
            len += n;
            var end = buf.AsSpan(0, len).IndexOf("\r\n\r\n"u8);
            if (end < 0) continue;
            // A browser waits for the 101 before sending frames; bytes past the
            // header mean something else is talking to us.
            if (end + 4 != len) return (null, null);
            return ParseHandshake(Encoding.ASCII.GetString(buf, 0, end));
        }
    }

    private (string? key, string? origin) ParseHandshake(string head)
    {
        var lines = head.Split("\r\n");
        var requestLine = lines[0].Split(' ');
        if (requestLine.Length != 3 || requestLine[0] != "GET" || requestLine[2] != "HTTP/1.1")
            return (null, null);

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) return (null, null);
            headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        string Header(string name) => headers.TryGetValue(name, out var v) ? v : "";

        if (!Header("Upgrade").Equals("websocket", StringComparison.OrdinalIgnoreCase)) return (null, null);
        if (!Header("Connection").Split(',').Any(t => t.Trim().Equals("Upgrade", StringComparison.OrdinalIgnoreCase))) return (null, null);
        if (Header("Sec-WebSocket-Version") != "13") return (null, null);
        if (Header("Host") != $"127.0.0.1:{Port}") return (null, null);

        var origin = headers.TryGetValue("Origin", out var o) ? o : null;
        if (origin != null && origin != "null" && !origin.StartsWith("file://", StringComparison.Ordinal))
            return (null, null); // an ordinary web page — never ours

        var key = Header("Sec-WebSocket-Key");
        try { if (Convert.FromBase64String(key).Length != 16) return (null, null); }
        catch (FormatException) { return (null, null); }
        return (key, origin);
    }

    private async Task<bool> AuthenticateAsync(WebSocket ws)
    {
        var buf = new byte[MaxAuthBytes];
        var len = 0;
        using (var cts = new CancellationTokenSource(HandshakeTimeout))
        {
            while (true)
            {
                if (len == buf.Length) return false;
                var r = await ws.ReceiveAsync(buf.AsMemory(len), cts.Token);
                if (r.MessageType != WebSocketMessageType.Text) return false;
                len += r.Count;
                if (r.EndOfMessage) break;
            }
        }

        try
        {
            using var doc = JsonDocument.Parse(buf.AsMemory(0, len));
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String || type.GetString() != "auth" ||
                !root.TryGetProperty("token", out var token) || token.ValueKind != JsonValueKind.String)
                return false;
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token.GetString()!), _token);
        }
        catch (JsonException) { return false; }
    }

    private async Task ReceiveLoopAsync(WebSocket ws)
    {
        var buf = new byte[16 * 1024];
        using var message = new MemoryStream();
        var pingLogged = false;
        while (ws.State == WebSocketState.Open)
        {
            var r = await ws.ReceiveAsync(buf.AsMemory(), CancellationToken.None);
            if (r.MessageType == WebSocketMessageType.Close) return;
            message.Write(buf, 0, r.Count);
            if (message.Length > MaxMessageBytes) return;
            if (!r.EndOfMessage) continue;

            string? type = null;
            try
            {
                using var doc = JsonDocument.Parse(message.GetBuffer().AsMemory(0, (int)message.Length));
                if (doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("type", out var t))
                    type = t.GetString();
            }
            catch (JsonException) { }
            message.SetLength(0);

            // Step 1 prototype: a ping/pong round trip proves both directions.
            if (type == "ping")
            {
                await SendAsync(ws, "{\"type\":\"pong\"}");
                if (!pingLogged) { _log?.Invoke("ws: ping round-trip ok"); pingLogged = true; }
            }
        }
    }

    private async Task SendAsync(WebSocket ws, string json)
    {
        await _sendLock.WaitAsync();
        try { await ws.SendAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text, true, CancellationToken.None); }
        finally { _sendLock.Release(); }
    }

    public void Dispose()
    {
        _listener.Stop();
        Interlocked.Exchange(ref _client, null)?.Abort();
    }
}
