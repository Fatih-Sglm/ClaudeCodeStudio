namespace ClaudeStudioAgent;

// Decides, per finished tool, whether to take a git snapshot and whether its
// diff belongs to that tool alone. A snapshot can't tell whose change is whose
// while file-changing tools overlap, so their diff is taken once, when the last
// of them finishes, and marked as shared (Parallel).
internal sealed class ToolChangeTracker
{
    public readonly record struct Snapshot(bool Report, bool Parallel);

    private readonly ISet<string> _reportTools;
    private readonly ISet<string> _selfDiffTools;
    private readonly Dictionary<string, string> _running = new(StringComparer.Ordinal);
    private bool _overlapped;
    private bool _overlapHasReporter;

    // reportTools: diff is sent (shell, subagents). selfDiffTools: they show
    // their own diff, so the snapshot only moves the baseline.
    public ToolChangeTracker(ISet<string> reportTools, ISet<string> selfDiffTools)
    {
        _reportTools = reportTools;
        _selfDiffTools = selfDiffTools;
    }

    public void Started(string toolId, string tool)
    {
        if (!_reportTools.Contains(tool) && !_selfDiffTools.Contains(tool)) return;
        if (_running.Count > 0) _overlapped = true;
        _running[toolId] = tool;
    }

    // Null: nothing to do now (not a file-changing tool, or others still run).
    public Snapshot? Finished(string toolId)
    {
        if (!_running.TryGetValue(toolId, out var tool)) return null;
        _running.Remove(toolId);
        var reports = _reportTools.Contains(tool);
        if (_overlapped) _overlapHasReporter |= reports;
        if (_running.Count > 0) return null;

        var result = _overlapped ? new Snapshot(_overlapHasReporter, true) : new Snapshot(reports, false);
        _overlapped = _overlapHasReporter = false;
        return result;
    }
}
