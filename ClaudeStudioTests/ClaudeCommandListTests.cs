using ClaudeStudioShared;
using Xunit;

namespace ClaudeStudioTests;

public class ClaudeCommandListTests
{
    [Fact]
    public void Parses_commands_from_the_initialize_answer()
    {
        var line = """{"type":"control_response","response":{"subtype":"success","request_id":"cmdlist","response":{"commands":[{"name":"compact","description":"Clear history but keep a summary","argumentHint":"<instructions>"},{"name":"superpowers:brainstorming","description":"(superpowers) Use before creative work"},{"name":""},{"description":"no name"}],"models":[]}}}""";
        var list = ClaudeCommandList.ParseInitializeResponse(line);
        Assert.NotNull(list);
        Assert.Equal(new[] { "compact", "superpowers:brainstorming" }, list!.Select(c => c.Name));
        Assert.Equal("<instructions>", list[0].ArgumentHint);
        Assert.Equal("", list[1].ArgumentHint);
    }

    [Theory]
    [InlineData("""{"type":"control_response","response":{"subtype":"success","request_id":"other","response":{"commands":[]}}}""")] // someone else's answer
    [InlineData("""{"type":"control_response","response":{"subtype":"error","request_id":"cmdlist","error":"nope"}}""")]
    [InlineData("""{"type":"system","subtype":"init"}""")]
    [InlineData("not json")]
    public void Ignores_anything_else(string line) =>
        Assert.Null(ClaudeCommandList.ParseInitializeResponse(line));

    [Fact]
    public void Request_line_is_an_initialize_control_request() =>
        Assert.Equal("""{"type":"control_request","request_id":"cmdlist","request":{"subtype":"initialize"}}""", ClaudeCommandList.InitializeRequestLine());
}
