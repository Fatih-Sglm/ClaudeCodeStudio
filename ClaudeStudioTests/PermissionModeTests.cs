using System.Text.Json;
using ClaudeStudioAgent;
using ClaudeStudioShared;
using Xunit;

namespace ClaudeStudioTests;

public class PermissionModeTests
{
    // ---- wire format: the webview sends these exact strings ----

    [Theory]
    [InlineData("ask", PermissionMode.Ask)]
    [InlineData("acceptEdits", PermissionMode.AcceptEdits)]
    [InlineData("plan", PermissionMode.Plan)]
    [InlineData("auto", PermissionMode.Auto)]
    [InlineData("bypassPermissions", PermissionMode.BypassPermissions)]
    public void Webview_mode_strings_deserialize(string wire, PermissionMode expected) =>
        Assert.Equal(expected, JsonSerializer.Deserialize<PermissionMode>($"\"{wire}\""));

    [Fact]
    public void ChatRequest_round_trips_mode_between_extension_and_agent()
    {
        var json = JsonSerializer.Serialize(new ChatRequest { PermissionMode = PermissionMode.AcceptEdits });
        Assert.Equal(PermissionMode.AcceptEdits, JsonSerializer.Deserialize<ChatRequest>(json)!.PermissionMode);
    }

    [Fact]
    public void Removed_mode_is_rejected_not_silently_mapped() =>
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<PermissionMode>("\"yolo\""));

    // ---- Auto: a CLI pause must reach the user, never be auto-allowed ----

    private static StreamEventResult ControlRequest(string tool, PermissionMode mode) =>
        StreamEventParser.Process(
            JsonSerializer.Deserialize<JsonElement>("""{"type":"control_request","request_id":"req1","request":{"subtype":"can_use_tool","tool_name":"TOOL","tool_use_id":"tu1","input":{"command":"x"}}}""".Replace("TOOL", tool)),
            new StreamEventState(), 0, @"C:\repo", "auto", mode);

    [Fact]
    public void Auto_mode_can_use_tool_becomes_permission_modal()
    {
        var result = ControlRequest("Bash", PermissionMode.Auto);
        Assert.Null(result.ControlAllowRequest);
        Assert.Equal("tu1", result.PendingControlPerm!.Value.ToolUseId);
        var chunk = Assert.Single(result.Chunks);
        Assert.Equal("permission_request", chunk.Type);
        Assert.Equal("Bash", chunk.Tool);
    }

    [Theory]
    [InlineData(PermissionMode.Ask)]
    [InlineData(PermissionMode.AcceptEdits)]
    [InlineData(PermissionMode.Plan)]
    [InlineData(PermissionMode.BypassPermissions)]
    public void Non_auto_modes_still_auto_allow_the_post_hook_can_use_tool(PermissionMode mode)
    {
        // In the hooked profile the PreToolUse hook already decided; claude
        // re-consults can_use_tool for e.g. compound Bash, which must not hang.
        var result = ControlRequest("Bash", mode);
        Assert.NotNull(result.ControlAllowRequest);
        Assert.Null(result.PendingControlPerm);
    }

    // ---- Remote Control: the CLI's bridge_state reaches the UI ----

    [Theory]
    [InlineData("ready")]
    [InlineData("connected")]
    public void Bridge_state_becomes_remote_state_chunk(string state)
    {
        var result = StreamEventParser.Process(
            JsonSerializer.Deserialize<JsonElement>("""{"type":"system","subtype":"bridge_state","state":"STATE"}""".Replace("STATE", state)),
            new StreamEventState(), 0, null, "bypassPermissions", PermissionMode.Ask);
        var chunk = Assert.Single(result.Chunks);
        Assert.Equal("remote-state", chunk.Type);
        Assert.Equal(state, chunk.Text);
    }

    // ---- Edit automatically: only edits that resolve inside the workspace ----

    private const string Root = @"C:\repo";

    [Theory]
    [InlineData("Edit", """{"file_path":"C:\\repo\\src\\a.cs"}""", true)]
    [InlineData("Write", """{"file_path":"src\\new.cs"}""", true)]                 // relative → under root
    [InlineData("MultiEdit", """{"file_path":"C:/repo/a.cs"}""", true)]
    [InlineData("NotebookEdit", """{"notebook_path":"C:\\repo\\n.ipynb"}""", true)]
    [InlineData("Edit", """{"file_path":"C:\\REPO\\a.cs"}""", true)]               // Windows paths are case-insensitive
    [InlineData("Edit", """{"file_path":"C:\\other\\a.cs"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo-evil\\a.cs"}""", false)]         // prefix, not a child
    [InlineData("Edit", """{"file_path":"C:\\repo\\..\\other\\a.cs"}""", false)]   // traversal out
    [InlineData("Write", """{"file_path":"..\\outside.cs"}""", false)]             // relative traversal out
    [InlineData("Edit", """{"file_path":"C:\\repo"}""", false)]                    // the root itself
    [InlineData("Edit", """{}""", false)]
    [InlineData("Bash", """{"command":"echo hi > C:\\repo\\a.txt"}""", false)]    // commands always ask
    [InlineData("PowerShell", """{"command":"Set-Content a.txt x"}""", false)]
    // Paths that can grant permissions or run code still ask.
    [InlineData("Edit", """{"file_path":"C:\\repo\\.git\\config"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.claude\\settings.local.json"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.CLAUDE\\settings.json"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\sub\\.git\\hooks\\pre-commit"}""", false)]   // nested repo
    [InlineData("Write", """{"file_path":"C:\\repo\\.mcp.json"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.gitattributes"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.vscode\\tasks.json"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.vs\\x.json"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\.husky\\pre-commit"}""", false)]
    // MSBuild runs these on project load (design-time build).
    [InlineData("Edit", """{"file_path":"C:\\repo\\src\\App.csproj"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo\\src\\App.VBPROJ"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\Directory.Build.targets"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\Directory.Build.props"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\src\\build\\custom.targets"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\src\\App.csproj.user"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\NuGet.Config"}""", false)]
    [InlineData("Write", """{"file_path":"C:\\repo\\global.json"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo\\src\\project-notes.md"}""", true)]
    // Names Windows maps onto other names.
    [InlineData("Edit", """{"file_path":"C:\\repo\\GIT~1\\config"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo\\.git.\\config"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo\\a.cs:stream"}""", false)]
    [InlineData("Edit", """{"file_path":"C:\\repo\\src\\gitignore-notes.md"}""", true)]     // look-alikes are fine
    [InlineData("Edit", """{"file_path":"C:\\repo\\docs\\claude\\a.md"}""", true)]
    public void IsEditInside(string tool, string input, bool expected) =>
        Assert.Equal(expected, PermissionPipeServer.IsEditInside(Root, tool, input));

    private static string Input(string path) => JsonSerializer.Serialize(new { file_path = path });

    [Fact]
    public void IsEditInside_asks_when_root_is_a_drive_or_holds_the_profile()
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var root in new[] { @"C:\", Path.GetPathRoot(profile)!, profile, Path.GetDirectoryName(profile)! })
            Assert.False(PermissionPipeServer.IsEditInside(root, "Write", Input(Path.Combine(profile, "AppData", "x.cs"))));
        Assert.True(PermissionPipeServer.IsEditInside(Path.Combine(profile, "src", "repo"), "Write", Input(Path.Combine(profile, "src", "repo", "a.cs"))));
    }

    [Fact]
    public void IsEditInside_asks_through_a_junction()
    {
        var root = Path.Combine(Path.GetTempPath(), "editroot-" + Guid.NewGuid().ToString("N"));
        var outside = Path.Combine(Path.GetTempPath(), "editout-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(outside);
        try
        {
            var link = Path.Combine(root, "linked");
            using (var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe", $"/c mklink /J \"{link}\" \"{outside}\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!)
                p.WaitForExit();
            Assert.True(Directory.Exists(link));

            Assert.False(PermissionPipeServer.IsEditInside(root, "Write", Input(Path.Combine(link, "a.cs"))));
            Assert.True(PermissionPipeServer.IsEditInside(root, "Write", Input(Path.Combine(root, "real", "a.cs"))));
        }
        finally
        {
            try { Directory.Delete(Path.Combine(root, "linked")); } catch { }
            try { Directory.Delete(root, true); } catch { }
            try { Directory.Delete(outside, true); } catch { }
        }
    }

    [Fact]
    public void IsEditInside_asks_for_a_hard_link_to_a_file_outside()
    {
        var root = Path.Combine(Path.GetTempPath(), "editroot-" + Guid.NewGuid().ToString("N"));
        var outside = Path.Combine(Path.GetTempPath(), "editout-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(outside);
        try
        {
            var target = Path.Combine(outside, "secret.txt");
            File.WriteAllText(target, "x");
            var link = Path.Combine(root, "innocent.cs");
            using (var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe", $"/c mklink /H \"{link}\" \"{target}\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!)
                p.WaitForExit();
            Assert.True(File.Exists(link));

            Assert.False(PermissionPipeServer.IsEditInside(root, "Edit", Input(link)));
            var plain = Path.Combine(root, "plain.cs");
            File.WriteAllText(plain, "y");
            Assert.True(PermissionPipeServer.IsEditInside(root, "Edit", Input(plain)));            // existing, single link
            Assert.True(PermissionPipeServer.IsEditInside(root, "Write", Input(Path.Combine(root, "new.cs")))); // not created yet
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
            try { Directory.Delete(outside, true); } catch { }
        }
    }
}
