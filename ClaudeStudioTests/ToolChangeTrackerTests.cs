using ClaudeStudioAgent;
using Xunit;

namespace ClaudeStudioTests;

public class ToolChangeTrackerTests
{
    private static ToolChangeTracker New() => new(
        new HashSet<string> { "Bash", "PowerShell", "Task" },
        new HashSet<string> { "Edit", "Write" });

    [Fact]
    public void Sequential_tools_each_get_their_own_snapshot()
    {
        var t = New();
        t.Started("1", "Bash");
        Assert.Equal(new ToolChangeTracker.Snapshot(true, false), t.Finished("1"));
        t.Started("2", "Edit");
        Assert.Equal(new ToolChangeTracker.Snapshot(false, false), t.Finished("2")); // baseline only
    }

    [Fact]
    public void Other_tools_are_ignored()
    {
        var t = New();
        t.Started("r", "Read");
        Assert.Null(t.Finished("r"));
        Assert.Null(t.Finished("unknown"));
    }

    [Fact]
    public void Overlapping_tools_share_one_diff_on_the_last_to_finish()
    {
        var t = New();
        t.Started("a", "Bash");
        t.Started("b", "PowerShell");
        Assert.Null(t.Finished("a"));                                              // b still running
        Assert.Equal(new ToolChangeTracker.Snapshot(true, true), t.Finished("b"));

        // The overlap doesn't leak into the next, lone tool.
        t.Started("c", "Bash");
        Assert.Equal(new ToolChangeTracker.Snapshot(true, false), t.Finished("c"));
    }

    [Fact]
    public void A_shell_overlapping_an_edit_still_reports_even_if_the_edit_ends_last()
    {
        var t = New();
        t.Started("sh", "Bash");
        t.Started("ed", "Edit");
        Assert.Null(t.Finished("sh"));
        Assert.Equal(new ToolChangeTracker.Snapshot(true, true), t.Finished("ed"));
    }

    [Fact]
    public void Parallel_edits_only_move_the_baseline()
    {
        var t = New();
        t.Started("e1", "Edit");
        t.Started("e2", "Write");
        Assert.Null(t.Finished("e2"));
        Assert.Equal(new ToolChangeTracker.Snapshot(false, true), t.Finished("e1"));
    }
}
