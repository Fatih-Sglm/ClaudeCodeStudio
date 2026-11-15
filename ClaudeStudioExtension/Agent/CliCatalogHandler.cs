using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace ClaudeStudioExtension.Agent;

// What the claude CLI offers beyond chat, for the panel: the "/" command list
// (folder scan + the CLI's own list) and the plugins panel (`claude plugin …`).
// Moved out of AgentToolWindowControl; posts its replies through postJson.
internal sealed class CliCatalogHandler
{
    private readonly Func<string?> _cliPath;
    private readonly Action<string> _postJson;

    // cliPath: the configured claude path (or null for detection).
    // postJson: posts one message to the webview (any thread).
    public CliCatalogHandler(Func<string?> cliPath, Action<string> postJson)
    {
        _cliPath = cliPath;
        _postJson = postJson;
    }

    // Discovers custom slash commands (V9): .claude/commands/**/*.md in the
    // project (working dir) and user (CLAUDE_CONFIG_DIR-aware) scopes. The CLI
    // expands these when the message text is "/name", so the ⌘ menu only needs
    // the names; subfolders namespace with ':' matching the CLI.
    public async Task SendSlashCommandsAsync(string? projectDir)
    {
        var result = await Task.Run(() =>
        {
            List<object> Scan(string? dir)
            {
                var items = new List<(string name, string description)>();
                try
                {
                    if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return new List<object>();
                    foreach (var file in Directory.EnumerateFiles(dir, "*.md", SearchOption.AllDirectories))
                    {
                        var rel = file.Substring(dir!.Length).TrimStart('\\', '/');
                        var name = rel.Substring(0, rel.Length - 3).Replace('\\', ':').Replace('/', ':');
                        items.Add((name, ReadFrontmatterDescription(file)));
                    }
                }
                catch { /* unreadable dir — treat as empty */ }
                return items.OrderBy(i => i.name, StringComparer.OrdinalIgnoreCase)
                            .Select(i => (object)new { i.name, i.description })
                            .ToList();
            }

            // Skills live one folder per skill (<dir>/<name>/SKILL.md), unlike
            // commands (one .md per command). Name = folder, description from
            // the SKILL.md frontmatter. The CLI expands "/<name>" for skills
            // the same way it does for commands.
            List<object> ScanSkills(string? dir)
            {
                var items = new List<(string name, string description)>();
                try
                {
                    if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return new List<object>();
                    foreach (var sub in Directory.EnumerateDirectories(dir))
                    {
                        var skillMd = System.IO.Path.Combine(sub, "SKILL.md");
                        if (!File.Exists(skillMd)) continue;
                        items.Add((System.IO.Path.GetFileName(sub), ReadFrontmatterDescription(skillMd)));
                    }
                }
                catch { /* unreadable dir — treat as empty */ }
                return items.OrderBy(i => i.name, StringComparer.OrdinalIgnoreCase)
                            .Select(i => (object)new { i.name, i.description })
                            .ToList();
            }

            var projectCmds = string.IsNullOrEmpty(projectDir)
                ? new List<object>()
                : Scan(System.IO.Path.Combine(projectDir, ".claude", "commands"));
            var projectSkills = string.IsNullOrEmpty(projectDir)
                ? new List<object>()
                : ScanSkills(System.IO.Path.Combine(projectDir, ".claude", "skills"));
            return new
            {
                project = projectCmds,
                user = Scan(ClaudePaths.UserCommandsDir),
                projectSkills,
                userSkills = ScanSkills(ClaudePaths.UserSkillsDir)
            };
        });

        // The scan answers at once; the CLI's own list (built-ins, plugins,
        // skills — what "/" really resolves to) comes from a short probe, once
        // per working directory per VS session, and replaces it when ready.
        void Post(List<ClaudeStudioShared.SlashCommandInfo>? cli)
        {
            var json = JsonSerializer.Serialize(new
            {
                type = "slash-commands",
                project = result.project,
                user = result.user,
                projectSkills = result.projectSkills,
                userSkills = result.userSkills,
                cli = cli?.Select(c => new { name = c.Name, description = c.Description, argumentHint = c.ArgumentHint })
            });
            _postJson(json);
        }

        var dirKey = projectDir ?? "";
        List<ClaudeStudioShared.SlashCommandInfo>? cached;
        bool startProbe;
        lock (_cliCommandsByDir)
        {
            _cliCommandsByDir.TryGetValue(dirKey, out cached);
            startProbe = cached == null && _cliCommandsProbing.Add(dirKey);
        }
        Post(cached);
        if (!startProbe) return;

        _ = Task.Run(async () =>
        {
            List<ClaudeStudioShared.SlashCommandInfo>? list = null;
            try { list = await ClaudeStudioShared.ClaudeCommandList.ProbeAsync(ClaudeStudioShared.ClaudeExeLocator.FindClaudeExe(_cliPath()), projectDir, TimeSpan.FromSeconds(30)); }
            catch (Exception ex) { OutputLog.Warn($"slash commands: CLI list probe failed: {ex.Message}"); }
            lock (_cliCommandsByDir)
            {
                _cliCommandsProbing.Remove(dirKey);
                if (list != null) _cliCommandsByDir[dirKey] = list;
            }
            if (list == null) { OutputLog.Info("slash commands: CLI list unavailable, keeping the scanned ones"); return; }
            OutputLog.Info($"slash commands: {list.Count} from the CLI");
            Post(list);
        });
    }

    public static class PluginMsg
    {
        public const string List = "plugins-list";
        public const string Action = "plugin-action";
        public const string Data = "plugins-data";
        public const string Result = "plugins-result";
    }

    // Plugins panel: list (installed + marketplaces' catalog) or one action,
    // all through `claude plugin …`. Results go back as plugins-data / plugins-result.
    public async Task HandlePluginRequestAsync(string type, ClaudeStudioShared.PluginAction? pluginAction, string? target, ClaudeStudioShared.PluginScope? scope, string? workingDir)
    {
        void Post(object payload)
        {
            var json = JsonSerializer.Serialize(payload);
            _postJson(json);
        }

        try
        {
            var exe = ClaudeStudioShared.ClaudeExeLocator.FindClaudeExe(_cliPath());
            if (type == PluginMsg.List)
            {
                var timeout = TimeSpan.FromSeconds(60);
                var listTask = ClaudeStudioShared.ClaudePluginCli.RunAsync(exe, ClaudeStudioShared.ClaudePluginCli.ListArgs(), workingDir, timeout);
                var mktsTask = ClaudeStudioShared.ClaudePluginCli.RunAsync(exe, ClaudeStudioShared.ClaudePluginCli.MarketplaceListArgs(), workingDir, timeout);
                var list = await listTask;
                var mkts = await mktsTask;
                if (!list.Ok || !mkts.Ok)
                {
                    Post(new { type = PluginMsg.Data, error = (!list.Ok ? list : mkts).ErrorText });
                    return;
                }
                var catalog = await Task.Run(() => ClaudeStudioShared.ClaudePluginCli.BuildCatalog(list.StdOut, mkts.StdOut));
                Post(new { type = PluginMsg.Data, catalog });
                return;
            }

            var action = pluginAction;
            var args = action == null ? null : ClaudeStudioShared.ClaudePluginCli.BuildArgs(action.Value, target, scope);
            if (args == null)
            {
                Post(new { type = PluginMsg.Result, action, target = target, ok = false, error = "invalid" });
                return;
            }
            OutputLog.Info($"plugins: {string.Join(" ", args)}");
            var result = await ClaudeStudioShared.ClaudePluginCli.RunAsync(exe, args, workingDir, TimeSpan.FromMinutes(3));
            if (!result.Ok) OutputLog.Warn($"plugins: {action} failed: {result.ErrorText}");
            // Plugin commands/skills changed: the "/" list must be asked again.
            if (result.Ok) lock (_cliCommandsByDir) _cliCommandsByDir.Clear();
            Post(new { type = PluginMsg.Result, action, target = target, ok = result.Ok, error = result.Ok ? null : result.ErrorText });
        }
        catch (Exception ex)
        {
            OutputLog.Warn($"plugins: {ex.Message}");
            Post(new { type = type == PluginMsg.List ? PluginMsg.Data : PluginMsg.Result, action = pluginAction, ok = false, error = ex.Message });
        }
    }

    // CLI slash-command lists per working directory (see SendSlashCommandsAsync).
    private static readonly Dictionary<string, List<ClaudeStudioShared.SlashCommandInfo>> _cliCommandsByDir = new(StringComparer.OrdinalIgnoreCase);
    private static readonly HashSet<string> _cliCommandsProbing = new(StringComparer.OrdinalIgnoreCase);

    // Pulls `description:` out of a command file's YAML frontmatter, if any.
    private static string ReadFrontmatterDescription(string file)
    {
        try
        {
            using var sr = new StreamReader(file);
            var first = sr.ReadLine();
            if (first == null || first.Trim() != "---") return "";
            for (int i = 0; i < 30; i++)
            {
                var line = sr.ReadLine();
                if (line == null || line.Trim() == "---") break;
                var t = line.TrimStart();
                if (t.StartsWith("description:", StringComparison.OrdinalIgnoreCase))
                    return t.Substring("description:".Length).Trim().Trim('"', '\'');
            }
        }
        catch { }
        return "";
    }
}
