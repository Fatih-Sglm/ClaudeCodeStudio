using System.Diagnostics;
using System.Text;

namespace ClaudeStudioAgent;

// "What did that command change?" for shell tools (Bash/PowerShell) and
// subagents — unlike Edit/Write they carry no old/new text to diff.
//
// Each snapshot is the whole working tree written as a git tree object through
// a PRIVATE index file (GIT_INDEX_FILE), so the user's real index, branch and
// working tree are never touched. The diff between two snapshots is exactly what
// changed in between: tracked edits, new files and deletions, .gitignore honoured.
//
// ponytail: `git add -A` hashes every non-ignored file that changed since the
// last snapshot; a repo with large un-ignored build output pays for that on
// each shell call. Ceiling: the 15 s timeout turns the feature off for the
// session. Snapshot blobs are unreachable loose objects; git gc prunes them.
internal sealed class GitSnapshot : IDisposable
{
    private const int MaxDiffChars = 200_000;
    private static readonly TimeSpan GitTimeout = TimeSpan.FromSeconds(15);

    private readonly string _workDir;
    private readonly string _tempDir;
    private readonly string _index;
    private string? _last; // tree id of the previous snapshot

    private GitSnapshot(string workDir, string tempDir)
    {
        _workDir = workDir;
        _tempDir = tempDir;
        _index = Path.Combine(tempDir, "index");
    }

    // Null when workDir isn't inside a git work tree or git isn't usable.
    public static async Task<GitSnapshot?> CreateAsync(string workDir)
    {
        var (ok, gitIndex) = await RunAsync(workDir, null, "rev-parse", "--git-path", "index");
        if (!ok || string.IsNullOrWhiteSpace(gitIndex)) return null;

        // claudestudio-* so the agent's startup sweep removes it after a crash.
        var tempDir = Path.Combine(Path.GetTempPath(), $"claudestudio-snap-{Environment.ProcessId}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        var snap = new GitSnapshot(workDir, tempDir);

        // Seed from the real index: its stat cache lets `add -A` skip files
        // that haven't changed instead of re-hashing the whole tree.
        try
        {
            var real = Path.GetFullPath(Path.Combine(workDir, gitIndex.Trim()));
            if (File.Exists(real)) File.Copy(real, snap._index);
        }
        catch { /* no seed — first snapshot is just slower */ }

        snap._last = await snap.TakeAsync();
        if (snap._last == null) { snap.Dispose(); return null; }
        return snap;
    }

    // One failure (timeout, broken repo) turns the feature off for the session
    // rather than charging every later shell call another timeout.
    private bool _broken;

    private async Task<string?> TakeAsync()
    {
        if (_broken) return null;
        string? tree = null;
        if ((await RunAsync(_workDir, _index, "add", "-A")).ok)
        {
            var (ok, output) = await RunAsync(_workDir, _index, "write-tree");
            if (ok) tree = output.Trim();
        }
        if (tree == null) _broken = true;
        return tree;
    }

    // Unified diff of everything that changed since the previous snapshot, then
    // that becomes the new baseline. "" = nothing changed (or git failed).
    public async Task<string> TakeDiffAsync()
    {
        var now = await TakeAsync();
        if (now == null) return "";
        var before = _last;
        _last = now;
        if (before == null || before == now) return "";

        var (ok, diff) = await RunAsync(_workDir, null, "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", before, now);
        if (!ok) return "";
        return diff.Length > MaxDiffChars ? diff[..MaxDiffChars] + "\n… diff truncated" : diff;
    }

    // Move the baseline without reporting: after Edit/Write (they show their
    // own diff) and at turn start (the user's own edits aren't claude's).
    public async Task AdvanceAsync()
    {
        var now = await TakeAsync();
        if (now != null) _last = now;
    }

    private static readonly string NullDevice = OperatingSystem.IsWindows() ? "NUL" : "/dev/null";

    private static async Task<(bool ok, string stdout)> RunAsync(string workDir, string? indexFile, params string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo("git")
            {
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8
            };
            // core.quotepath: non-ASCII paths as-is. The rest: this runs on its own
            // after every tool call, so it must not run commands from repo config
            // (fsmonitor, hooks). ponytail: filter.*.clean drivers can't be turned off
            // by name-agnostic config; .git/ edits always prompt (PermissionPipeServer.IsEditInside).
            foreach (var setting in new[] { "core.quotepath=false", "core.fsmonitor=false", "core.hooksPath=" + NullDevice })
            {
                psi.ArgumentList.Add("-c");
                psi.ArgumentList.Add(setting);
            }
            foreach (var a in args) psi.ArgumentList.Add(a);
            if (indexFile != null) psi.EnvironmentVariables["GIT_INDEX_FILE"] = indexFile;
            psi.EnvironmentVariables["GIT_OPTIONAL_LOCKS"] = "0";

            using var proc = Process.Start(psi);
            if (proc == null) return (false, "");
            using var cts = new CancellationTokenSource(GitTimeout);
            var stdout = proc.StandardOutput.ReadToEndAsync(cts.Token);
            var stderr = proc.StandardError.ReadToEndAsync(cts.Token);
            try { await proc.WaitForExitAsync(cts.Token); }
            catch (OperationCanceledException) { try { proc.Kill(entireProcessTree: true); } catch { } return (false, ""); }
            return (proc.ExitCode == 0, await stdout);
        }
        catch { return (false, ""); }
    }

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }
}
