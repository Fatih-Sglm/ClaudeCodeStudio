using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace ClaudeStudioShared;

public sealed class SlashCommandInfo
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string ArgumentHint { get; set; } = "";
}

// The CLI's own slash-command list: built-ins, user/project commands, skills
// and plugin commands — exactly what /<name> resolves to in a session.
// Asked with control_request {subtype:"initialize"}, which answers without a
// model call (probed on 2.1.323: 141 commands incl. 66 plugin ones).
public static class ClaudeCommandList
{
    private const string RequestId = "cmdlist";

    // Hooks off (no SessionStart side effects per probe) and an empty strict MCP
    // config (no server spawns/connects). Cost: MCP prompt commands aren't listed.
    private static readonly string[] ProbeArgs =
    {
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--permission-prompt-tool", "stdio",
        "--settings", "{\"disableAllHooks\":true}",
        "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"
    };

    public static string InitializeRequestLine() =>
        JsonSerializer.Serialize(new { type = "control_request", request_id = RequestId, request = new { subtype = "initialize" } });

    // The command list from one stdout line, or null when the line isn't the
    // answer to our initialize request (or the answer is an error).
    public static List<SlashCommandInfo>? ParseInitializeResponse(string line)
    {
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("type", out var type) || type.GetString() != "control_response" ||
                !root.TryGetProperty("response", out var resp) ||
                !resp.TryGetProperty("request_id", out var rid) || rid.GetString() != RequestId ||
                !resp.TryGetProperty("response", out var inner) ||
                !inner.TryGetProperty("commands", out var commands) || commands.ValueKind != JsonValueKind.Array)
                return null;

            var list = new List<SlashCommandInfo>();
            foreach (var c in commands.EnumerateArray())
            {
                if (c.ValueKind != JsonValueKind.Object || !c.TryGetProperty("name", out var n) || n.ValueKind != JsonValueKind.String) continue;
                var name = n.GetString() ?? "";
                if (name.Length == 0) continue;
                list.Add(new SlashCommandInfo
                {
                    Name = name,
                    Description = c.TryGetProperty("description", out var d) && d.ValueKind == JsonValueKind.String ? d.GetString() ?? "" : "",
                    ArgumentHint = c.TryGetProperty("argumentHint", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() ?? "" : ""
                });
            }
            return list;
        }
        catch (JsonException) { return null; }
    }

    // Starts claude briefly in workingDirectory, asks for the list, shuts it
    // down. Null on any failure (missing exe, timeout, unexpected output).
    public static async Task<List<SlashCommandInfo>?> ProbeAsync(string claudeExe, string? workingDirectory, TimeSpan timeout)
    {
        Process? proc = null;
        try
        {
            var psi = new ProcessStartInfo(claudeExe)
            {
                Arguments = string.Join(" ", ProbeArgs.Select(QuoteArg)),
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8
            };
            if (!string.IsNullOrEmpty(workingDirectory) && Directory.Exists(workingDirectory))
                psi.WorkingDirectory = workingDirectory;
            psi.EnvironmentVariables["CLAUDE_CODE_ENTRYPOINT"] = "claude-vs2022";

            proc = Process.Start(psi);
            if (proc == null) return null;
            proc.ErrorDataReceived += (_, _) => { }; // drain so a chatty stderr can't block it
            proc.BeginErrorReadLine();

            await proc.StandardInput.WriteLineAsync(InitializeRequestLine());
            await proc.StandardInput.FlushAsync();

            var reading = ReadUntilAnswerAsync(proc.StandardOutput);
            var finished = await Task.WhenAny(reading, Task.Delay(timeout));
            return finished == reading ? await reading : null;
        }
        catch { return null; }
        finally
        {
            if (proc != null)
            {
                // Closing stdin lets claude exit on its own; kill only if it lingers.
                try { proc.StandardInput.Close(); } catch { }
                try { if (!proc.WaitForExit(3000)) proc.Kill(); } catch { }
                proc.Dispose();
            }
        }
    }

    private static async Task<List<SlashCommandInfo>?> ReadUntilAnswerAsync(StreamReader stdout)
    {
        string? line;
        while ((line = await stdout.ReadLineAsync()) != null)
        {
            if (line.IndexOf("control_response", StringComparison.Ordinal) < 0) continue;
            var list = ParseInitializeResponse(line);
            if (list != null) return list;
        }
        return null;
    }

    // Windows command-line quoting for ProcessStartInfo.Arguments (netstandard2.0
    // has no ArgumentList): wrap in quotes, escape inner quotes and the
    // backslashes that precede them.
    internal static string QuoteArg(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
        var sb = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var ch in arg)
        {
            if (ch == '\\') { backslashes++; continue; }
            if (ch == '"') sb.Append('\\', backslashes * 2 + 1);
            else sb.Append('\\', backslashes);
            backslashes = 0;
            sb.Append(ch);
        }
        sb.Append('\\', backslashes * 2).Append('"');
        return sb.ToString();
    }
}
