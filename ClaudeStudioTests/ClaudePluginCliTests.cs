using ClaudeStudioShared;
using Xunit;

namespace ClaudeStudioTests;

public class ClaudePluginCliTests
{
    [Fact]
    public void Install_BuildsScopedJsonArgs_WithoutAutoConfirm()
    {
        var args = ClaudePluginCli.BuildArgs(PluginAction.Install, "figma@claude-plugins-official", PluginScope.Project);
        Assert.Equal(new[] { "plugin", "install", "figma@claude-plugins-official", "--scope", "project", "--json" }, args);
        Assert.DoesNotContain("-y", args!);
    }

    [Theory]
    [InlineData(PluginAction.Install, "--evil")]
    [InlineData(PluginAction.Uninstall, "a b")]
    [InlineData(PluginAction.Enable, "")]
    [InlineData(PluginAction.Disable, "x@y@z")]
    [InlineData(PluginAction.MarketplaceRemove, "name@market")]
    [InlineData(PluginAction.MarketplaceAdd, "-y")]
    [InlineData(PluginAction.MarketplaceAdd, "owner/repo\n--yes")]
    [InlineData(PluginAction.MarketplaceAdd, "")]
    public void BadTargets_AreRejected(PluginAction action, string target)
    {
        Assert.Null(ClaudePluginCli.BuildArgs(action, target, null));
    }

    [Fact]
    public void MarketplaceAdd_AcceptsRepoUrlOrPath()
    {
        Assert.Equal(new[] { "plugin", "marketplace", "add", "owner/repo", "--json" }, ClaudePluginCli.BuildArgs(PluginAction.MarketplaceAdd, " owner/repo ", null));
        Assert.NotNull(ClaudePluginCli.BuildArgs(PluginAction.MarketplaceAdd, "https://github.com/a/b.git", null));
        Assert.NotNull(ClaudePluginCli.BuildArgs(PluginAction.MarketplaceAdd, @"C:\My Plugins\market", null));
    }

    [Fact]
    public void MarketplaceUpdate_WithoutName_UpdatesAll()
    {
        Assert.Equal(new[] { "plugin", "marketplace", "update" }, ClaudePluginCli.BuildArgs(PluginAction.MarketplaceUpdate, "", null));
        Assert.Equal(new[] { "plugin", "marketplace", "update", "mattpocock", "--json" }, ClaudePluginCli.BuildArgs(PluginAction.MarketplaceUpdate, "mattpocock", null));
    }

    [Fact]
    public void BuildCatalog_TrimsCliOutput()
    {
        const string list = """
        {"installed":[{"id":"figma@official","version":"2.2.157","scope":"user","enabled":true,"installPath":"C:\\x"},
                      {"id":"off@m","scope":"project","enabled":false}],
         "available":[{"pluginId":"a@official","name":"a","description":"A plugin","marketplaceName":"official","source":{"source":"git"},"installCount":42}]}
        """;
        const string mkts = """
        [{"name":"official","source":"git","url":"https://github.com/x/y.git"},{"name":"gh","source":"github","repo":"o/r"},{"name":"dir","source":"directory","path":"C:\\m"}]
        """;
        var json = System.Text.Json.JsonSerializer.Serialize(ClaudePluginCli.BuildCatalog(list, mkts));

        Assert.Contains("\"id\":\"figma@official\",\"version\":\"2.2.157\",\"scope\":\"user\",\"enabled\":true", json);
        Assert.Contains("\"id\":\"off@m\",\"version\":\"\",\"scope\":\"project\",\"enabled\":false", json);
        Assert.Contains("\"id\":\"a@official\",\"name\":\"a\",\"description\":\"A plugin\",\"marketplace\":\"official\",\"installs\":42", json);
        Assert.Contains("{\"name\":\"gh\",\"source\":\"o/r\"}", json);
        Assert.Contains("{\"name\":\"official\",\"source\":\"https://github.com/x/y.git\"}", json);
        Assert.DoesNotContain("installPath", json);
    }

    [Fact]
    public void WireEnums_ParseCaseInsensitively()
    {
        var o = System.Text.Json.JsonSerializer.Deserialize<Probe>("{\"a\":\"MarketplaceAdd\",\"s\":\"user\"}");
        Assert.Equal(PluginAction.MarketplaceAdd, o!.a);
        Assert.Equal(PluginScope.User, o.s);
    }

    private sealed class Probe
    {
        public PluginAction? a { get; set; }
        public PluginScope? s { get; set; }
    }
}
