using System.Diagnostics;
using ClaudeStudioAgent;
using Xunit;

namespace ClaudeStudioTests;

public class GitSnapshotTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "snaptest-" + Guid.NewGuid().ToString("N"));

    public GitSnapshotTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(_dir, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
            Directory.Delete(_dir, recursive: true);
        }
        catch { }
    }

    private string Git(params string[] args)
    {
        var psi = new ProcessStartInfo("git") { WorkingDirectory = _dir, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        return output;
    }

    private void InitRepo()
    {
        Git("init", "-q");
        Git("config", "user.email", "t@t");
        Git("config", "user.name", "t");
        File.WriteAllText(Path.Combine(_dir, "a.txt"), "one\n");
        Git("add", "a.txt");
        Git("commit", "-q", "-m", "init");
    }

    [Fact]
    public async Task Diff_shows_edits_and_new_files_and_leaves_the_real_index_alone()
    {
        InitRepo();
        using var snap = (await GitSnapshot.CreateAsync(_dir))!;
        Assert.NotNull(snap);

        File.WriteAllText(Path.Combine(_dir, "a.txt"), "one\ntwo\n");
        File.WriteAllText(Path.Combine(_dir, "b.txt"), "brand new\n");
        var diff = await snap.TakeDiffAsync();

        Assert.Contains("a/a.txt", diff);
        Assert.Contains("+two", diff);
        Assert.Contains("b/b.txt", diff);
        Assert.Contains("+brand new", diff);
        // The user's index is untouched: b.txt is still untracked, a.txt unstaged.
        var status = Git("status", "--porcelain");
        Assert.Contains(" M a.txt", status);
        Assert.Contains("?? b.txt", status);
    }

    [Fact]
    public async Task Each_diff_covers_only_what_changed_since_the_previous_one()
    {
        InitRepo();
        using var snap = (await GitSnapshot.CreateAsync(_dir))!;

        File.WriteAllText(Path.Combine(_dir, "a.txt"), "one\ntwo\n");
        Assert.Contains("+two", await snap.TakeDiffAsync());
        Assert.Equal("", await snap.TakeDiffAsync()); // nothing new

        // An Edit/Write in between only moves the baseline.
        File.WriteAllText(Path.Combine(_dir, "a.txt"), "one\ntwo\nthree\n");
        await snap.AdvanceAsync();
        File.Delete(Path.Combine(_dir, "a.txt"));
        var diff = await snap.TakeDiffAsync();
        Assert.Contains("deleted file", diff);
        Assert.DoesNotContain("+three", diff);
    }

    [Fact]
    public async Task Repo_fsmonitor_command_does_not_run()
    {
        InitRepo();
        Git("config", "core.fsmonitor", "echo ran > fsmon-ran.txt");
        var marker = Path.Combine(_dir, "fsmon-ran.txt");

        using var snap = (await GitSnapshot.CreateAsync(_dir))!;
        File.WriteAllText(Path.Combine(_dir, "a.txt"), "changed\n");
        await snap.TakeDiffAsync();
        Assert.False(File.Exists(marker));

        Git("status"); // control: plain git does run it, so the check above means something
        Assert.True(File.Exists(marker));
    }

    [Fact]
    public async Task Not_a_git_repo_turns_the_feature_off() =>
        Assert.Null(await GitSnapshot.CreateAsync(_dir));
}
