using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ClaudeStudioShared;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PluginAction { List, Install, Uninstall, Enable, Disable, Update, MarketplaceAdd, MarketplaceRemove, MarketplaceUpdate }

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PluginScope { User, Project, Local }

public sealed class PluginCliResult
{
    public int ExitCode { get; set; }
    public string StdOut { get; set; } = "";
    public string StdErr { get; set; } = "";
    public bool TimedOut { get; set; }
    public bool Ok => !TimedOut && ExitCode == 0;

    // What to show the user on failure: the CLI's own words, last line first.
    public string ErrorText
    {
        get
        {
            if (TimedOut) return "timeout";
            var text = StdErr.Trim().Length > 0 ? StdErr : StdOut;
            var lines = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? $"exit {ExitCode}" : string.Join("\n", lines.Skip(Math.Max(0, lines.Length - 3)));
        }
    }
}

// /plugin for the panel: thin wrapper over `claude plugin …` — the CLI owns the
// marketplaces, installs and settings; we only build validated argument lists.
public static class ClaudePluginCli
{
    private const string Plugin = "plugin";
    private const string Marketplace = "marketplace";
    private const string Json = "--json";
    private const string ScopeFlag = "--scope";

    // plugin or plugin@marketplace; marketplace names alone use the same shape.
    private static readonly Regex IdPattern = new(@"^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$");
    private static readonly Regex NamePattern = new(@"^[A-Za-z0-9][A-Za-z0-9._-]*$");
    private const int MaxSourceLength = 500;

    public static string[] ListArgs() => new[] { Plugin, "list", Json, "--available" };

    public static string[] MarketplaceListArgs() => new[] { Plugin, Marketplace, "list", Json };

    // Null when the target doesn't fit the action (never reaches the CLI).
    // No -y anywhere: a marketplace-declared command must be confirmed by a
    // person, so such installs fail here and the CLI's message says why.
    public static string[]? BuildArgs(PluginAction action, string? target, PluginScope? scope)
    {
        target = target?.Trim() ?? "";
        var scopeArgs = scope == null ? Array.Empty<string>() : new[] { ScopeFlag, scope.Value.ToString().ToLowerInvariant() };
        string[] With(params string[] head) => head.Concat(scopeArgs).Concat(new[] { Json }).ToArray();

        switch (action)
        {
            case PluginAction.Install: return IdPattern.IsMatch(target) ? With(Plugin, "install", target) : null;
            case PluginAction.Uninstall: return IdPattern.IsMatch(target) ? With(Plugin, "uninstall", target) : null;
            case PluginAction.Enable: return IdPattern.IsMatch(target) ? With(Plugin, "enable", target) : null;
            case PluginAction.Disable: return IdPattern.IsMatch(target) ? With(Plugin, "disable", target) : null;
            case PluginAction.Update: return IdPattern.IsMatch(target) ? With(Plugin, "update", target) : null;
            case PluginAction.MarketplaceRemove: return NamePattern.IsMatch(target) ? With(Plugin, Marketplace, "remove", target) : null;
            case PluginAction.MarketplaceUpdate:
                // No name = update all (the CLI's --json needs a name, so skip it then).
                if (target.Length == 0) return new[] { Plugin, Marketplace, "update" };
                return NamePattern.IsMatch(target) ? new[] { Plugin, Marketplace, "update", target, Json } : null;
            case PluginAction.MarketplaceAdd:
                // owner/repo, URL or path. Free text, but never an option and never multi-line.
                if (target.Length == 0 || target.Length > MaxSourceLength || target[0] == '-' || target.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0) return null;
                return With(Plugin, Marketplace, "add", target);
            default: return null;
        }
    }

    public static async Task<PluginCliResult> RunAsync(string claudeExe, string[] args, string? workingDirectory, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo(claudeExe)
        {
            Arguments = string.Join(" ", args.Select(ClaudeCommandList.QuoteArg)),
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        if (!string.IsNullOrEmpty(workingDirectory) && Directory.Exists(workingDirectory))
            psi.WorkingDirectory = workingDirectory;
        psi.EnvironmentVariables["CLAUDE_CODE_ENTRYPOINT"] = "claude-vs2022";

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("claude did not start");
        proc.StandardInput.Close(); // no TTY prompts: anything interactive fails instead of hanging
        var stdout = proc.StandardOutput.ReadToEndAsync();
        var stderr = proc.StandardError.ReadToEndAsync();
        var both = Task.WhenAll(stdout, stderr);
        if (await Task.WhenAny(both, Task.Delay(timeout)) != both)
        {
            try { proc.Kill(); } catch { }
            return new PluginCliResult { TimedOut = true, ExitCode = -1 };
        }
        proc.WaitForExit();
        return new PluginCliResult { ExitCode = proc.ExitCode, StdOut = stdout.Result, StdErr = stderr.Result };
    }

    // The panel's data from `plugin list --json --available` and
    // `plugin marketplace list --json`, trimmed to what the panel shows
    // (the raw list is ~2 MB, mostly source metadata).
    public static object BuildCatalog(string listJson, string marketplacesJson)
    {
        using var list = JsonDocument.Parse(listJson);
        using var mkts = JsonDocument.Parse(marketplacesJson);
        string Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        IEnumerable<JsonElement> Arr(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray() : Enumerable.Empty<JsonElement>();

        var installed = Arr(list.RootElement, "installed").Select(p => new
        {
            id = Str(p, "id"),
            version = Str(p, "version"),
            scope = Str(p, "scope"),
            enabled = p.TryGetProperty("enabled", out var en) && en.ValueKind == JsonValueKind.True
        }).ToList();
        var available = Arr(list.RootElement, "available").Select(p => new
        {
            id = Str(p, "pluginId"),
            name = Str(p, "name"),
            description = Str(p, "description"),
            marketplace = Str(p, "marketplaceName"),
            installs = p.TryGetProperty("installCount", out var c) && c.TryGetInt64(out var n) ? n : 0
        }).ToList();
        var marketplaces = (mkts.RootElement.ValueKind == JsonValueKind.Array ? mkts.RootElement.EnumerateArray() : Enumerable.Empty<JsonElement>())
            .Select(m => new
            {
                name = Str(m, "name"),
                source = Str(m, "repo") is { Length: > 0 } repo ? repo : Str(m, "url") is { Length: > 0 } url ? url : Str(m, "path")
            }).ToList();
        return new { installed, available, marketplaces };
    }
}
