using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Markup;
using Microsoft.VisualStudio.Shell;

namespace ClaudeStudioExtension.Localization;

// English/Turkish strings for the native (WPF) windows and the texts the host
// posts into the chat webview. The language follows the chat's Appearance →
// Language choice, mirrored to AppearanceSettings.UiLanguage: "auto" follows the
// Visual Studio UI language ("tr" → Turkish, anything else → English).
// XAML binds through {l:Loc key}, so static labels re-localize live on Reload();
// code-built texts are re-rendered by each window on NativeTheme.Changed.
public sealed class Strings : INotifyPropertyChanged
{
    public static Strings Instance { get; } = new();

    public event PropertyChangedEventHandler? PropertyChanged;

    public string this[string key] => Get(key);

    public static bool IsTurkish { get; private set; } = Resolve();

    public static CultureInfo Culture => CultureInfo.GetCultureInfo(IsTurkish ? "tr-TR" : "en-US");

    public static string Get(string key) => IsTurkish && Tr.TryGetValue(key, out var tr) ? tr : En.TryGetValue(key, out var en) ? en : key;

    public static string Format(string key, params object[] args) => string.Format(Culture, Get(key), args);

    public static void Reload()
    {
        IsTurkish = Resolve();
        Instance.PropertyChanged?.Invoke(Instance, new PropertyChangedEventArgs(Binding.IndexerName));
    }

    public static void BindCaption(ToolWindowPane pane, string key)
    {
        pane.Caption = Get(key);
#pragma warning disable VSSDK007
        Theming.NativeTheme.Changed += () => ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            pane.Caption = Get(key);
        }).FileAndForget("ClaudeStudio/Caption");
#pragma warning restore VSSDK007
    }

    private static bool Resolve()
    {
        var pref = Theming.AppearanceSettings.Load().UiLanguage;
        if (string.Equals(pref, "tr", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(pref, "en", StringComparison.OrdinalIgnoreCase)) return false;
        return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "tr";
    }

    private static readonly Dictionary<string, string> En = new()
    {
        ["usage.caption"] = "Claude Code Studio Usage",
        ["usage.refresh"] = "🔄 Refresh",
        ["usage.range.all"] = "All time",
        ["usage.range.today"] = "Today",
        ["usage.range.7"] = "7 days",
        ["usage.range.30"] = "30 days",
        ["usage.allProjects"] = "all projects",
        ["usage.allSessions"] = "All sessions",
        ["usage.untitled"] = "(untitled)",
        ["usage.unknownProject"] = "(unknown)",
        ["usage.error"] = "error",
        ["usage.planLimits"] = "Plan limits",
        ["usage.refreshLimits"] = "Refresh plan limits",
        ["usage.loading"] = "Loading…",
        ["usage.updating"] = "Updating…",
        ["usage.cliNotFound"] = "Claude CLI not found.",
        ["usage.limitsFailed"] = "Could not read plan limits.",
        ["usage.currentSession"] = "Current session",
        ["usage.thisWeek"] = "This week",
        ["usage.resets"] = "resets {0}",
        ["usage.totalCost"] = "Total cost",
        ["usage.input"] = "Input",
        ["usage.output"] = "Output",
        ["usage.cache"] = "Cache",
        ["usage.sessions"] = "Sessions",
        ["usage.col.lastActivity"] = "Last activity",
        ["usage.col.project"] = "Project",
        ["usage.col.model"] = "Model",
        ["usage.col.in"] = "In",
        ["usage.col.out"] = "Out",
        ["usage.col.cacheRead"] = "Cache R",
        ["usage.col.turns"] = "Turns",
        ["usage.col.cost"] = "Cost",

        ["mcp.caption"] = "Claude Code Studio MCP Servers",
        ["mcp.tab.project"] = "Project",
        ["mcp.tab.user"] = "User",
        ["mcp.refresh"] = "Refresh",
        ["mcp.addServer"] = "+ Add server",
        ["mcp.experimental"] = "experimental",
        ["mcp.toggleEnabled"] = "Toggle enabled / disabled",
        ["mcp.template"] = "Template",
        ["mcp.customTemplate"] = "(custom)",
        ["mcp.name"] = "Name",
        ["mcp.transport"] = "Transport",
        ["mcp.command"] = "Command",
        ["mcp.args"] = "Args (one per line)",
        ["mcp.env"] = "Environment variables",
        ["mcp.addEnv"] = "+ Add env",
        ["mcp.url"] = "URL",
        ["mcp.headers"] = "Headers",
        ["mcp.addHeader"] = "+ Add header",
        ["mcp.cancel"] = "Cancel",
        ["mcp.delete"] = "Delete",
        ["mcp.save"] = "Save",
        ["mcp.errorLoading"] = "Error loading: {0}",
        ["mcp.noSolution"] = "No solution open. Project scope unavailable.",
        ["mcp.willBeCreated"] = "  (will be created)",
        ["mcp.noServers"] = "No MCP servers configured.",
        ["mcp.noCommand"] = "(no command)",
        ["mcp.noUrl"] = "(no url)",
        ["mcp.disabled"] = "disabled",
        ["mcp.newServer"] = "New server",
        ["mcp.editTitle"] = "Edit: {0}",
        ["mcp.show"] = "show",
        ["mcp.hide"] = "hide",
        ["mcp.kvEnv"] = "env var",
        ["mcp.kvHeader"] = "header",
        ["mcp.emptyKey"] = "Empty {0} key",
        ["mcp.duplicateKey"] = "Duplicate {0}: {1}",
        ["mcp.nameExists"] = "A server with this name already exists",
        ["mcp.commandRequired"] = "Command is required",
        ["mcp.urlRequired"] = "URL is required",
        ["mcp.urlInvalid"] = "URL must be a valid http or https URL (e.g. https://example.com)",
        ["mcp.saveFailed"] = "Save failed: {0}",
        ["mcp.deleteConfirm"] = "Delete server '{0}'?",
        ["mcp.deleteConfirmTitle"] = "Confirm delete",
        ["mcp.deleteFailed"] = "Delete failed: {0}",
        ["mcp.nameRequired"] = "Name is required",
        ["mcp.nameTooLong"] = "Name too long",
        ["mcp.nameChars"] = "Name can only contain letters, digits, '-' and '_'",

        ["status.thinking"] = "⟳ Claude thinking…",
        ["export.empty"] = "Nothing to export — chat is empty.",
        ["export.title"] = "Export chat to Markdown",
        ["export.filter"] = "Markdown (*.md)|*.md|All files (*.*)|*.*",
        ["export.done"] = "Chat exported to {0}",
        ["export.failed"] = "Export failed: {0}",
        ["attach.title"] = "Select file",
        ["attach.filter"] = "All files (*.*)|*.*|Text files|*.txt;*.cs;*.js;*.ts;*.html;*.css;*.json;*.xml;*.md;*.py;*.cpp;*.h",
        ["toast.noEditor"] = "No active editor — open a file first.",
        ["sideq.empty"] = "empty question",
        ["mcp.missingServer"] = "missing server name",
        ["rewind.noSession"] = "No active session.",
        ["rewind.notActive"] = "This session isn't active yet — send a message first, then rewind.",
        ["rewind.noTranscript"] = "Session transcript not found.",
        ["rewind.readFailed"] = "Could not read transcript.",
        ["rewind.notFound"] = "Could not locate that message in the transcript.",
        ["rewind.failed"] = "Rewind failed.",
        ["diff.noSolution"] = "No solution open.",
        ["diff.notRepo"] = "Not a git repository.",
        ["diff.notRepoBody"] = "This project is not under git version control.\n\nInitialize a repository in VS to enable diffs.",
        ["diff.noCommitStat"] = " {0} files (no initial commit yet), {1} insertions(+)",
        ["diff.emptyRepo"] = "Repository initialized but empty.",
        ["diff.noFiles"] = "No tracked or untracked files to show.",
        ["diff.noChanges"] = "No changes since the last commit.",
        ["diff.error"] = "Error computing diff: {0}",
        ["cost.session"] = "session ${0:F2} / ${1:F2}",
        ["cost.today"] = "today ${0:F2} / ${1:F2}",
        ["cost.limitReached"] = "limit reached",
    };

    private static readonly Dictionary<string, string> Tr = new()
    {
        ["usage.caption"] = "Claude Code Studio Kullanım",
        ["usage.refresh"] = "🔄 Yenile",
        ["usage.range.all"] = "Tüm zamanlar",
        ["usage.range.today"] = "Bugün",
        ["usage.range.7"] = "7 gün",
        ["usage.range.30"] = "30 gün",
        ["usage.allProjects"] = "tüm projeler",
        ["usage.allSessions"] = "Tüm oturumlar",
        ["usage.untitled"] = "(adsız)",
        ["usage.unknownProject"] = "(bilinmiyor)",
        ["usage.error"] = "hata",
        ["usage.planLimits"] = "Plan sınırları",
        ["usage.refreshLimits"] = "Plan sınırlarını yenile",
        ["usage.loading"] = "Yükleniyor…",
        ["usage.updating"] = "Güncelleniyor…",
        ["usage.cliNotFound"] = "Claude CLI bulunamadı.",
        ["usage.limitsFailed"] = "Plan sınırları okunamadı.",
        ["usage.currentSession"] = "Geçerli oturum",
        ["usage.thisWeek"] = "Bu hafta",
        ["usage.resets"] = "sıfırlanma: {0}",
        ["usage.totalCost"] = "Toplam maliyet",
        ["usage.input"] = "Input",
        ["usage.output"] = "Output",
        ["usage.cache"] = "Cache",
        ["usage.sessions"] = "Oturumlar",
        ["usage.col.lastActivity"] = "Son etkinlik",
        ["usage.col.project"] = "Proje",
        ["usage.col.model"] = "Model",
        ["usage.col.in"] = "In",
        ["usage.col.out"] = "Out",
        ["usage.col.cacheRead"] = "Cache R",
        ["usage.col.turns"] = "Turns",
        ["usage.col.cost"] = "Maliyet",

        ["mcp.caption"] = "Claude Code Studio MCP Sunucuları",
        ["mcp.tab.project"] = "Proje",
        ["mcp.tab.user"] = "Kullanıcı",
        ["mcp.refresh"] = "Yenile",
        ["mcp.addServer"] = "+ Sunucu ekle",
        ["mcp.experimental"] = "deneysel",
        ["mcp.toggleEnabled"] = "Etkinleştir / devre dışı bırak",
        ["mcp.template"] = "Şablon",
        ["mcp.customTemplate"] = "(özel)",
        ["mcp.name"] = "Ad",
        ["mcp.transport"] = "Transport",
        ["mcp.command"] = "Komut",
        ["mcp.args"] = "Argümanlar (satır başına bir tane)",
        ["mcp.env"] = "Ortam değişkenleri",
        ["mcp.addEnv"] = "+ Ortam değişkeni ekle",
        ["mcp.url"] = "URL",
        ["mcp.headers"] = "Header'lar",
        ["mcp.addHeader"] = "+ Header ekle",
        ["mcp.cancel"] = "İptal",
        ["mcp.delete"] = "Sil",
        ["mcp.save"] = "Kaydet",
        ["mcp.errorLoading"] = "Yükleme hatası: {0}",
        ["mcp.noSolution"] = "Açık solution yok. Proje kapsamı kullanılamıyor.",
        ["mcp.willBeCreated"] = "  (oluşturulacak)",
        ["mcp.noServers"] = "Yapılandırılmış MCP sunucusu yok.",
        ["mcp.noCommand"] = "(komut yok)",
        ["mcp.noUrl"] = "(url yok)",
        ["mcp.disabled"] = "devre dışı",
        ["mcp.newServer"] = "Yeni sunucu",
        ["mcp.editTitle"] = "Düzenle: {0}",
        ["mcp.show"] = "göster",
        ["mcp.hide"] = "gizle",
        ["mcp.kvEnv"] = "ortam değişkeni",
        ["mcp.kvHeader"] = "header",
        ["mcp.emptyKey"] = "Boş {0} anahtarı",
        ["mcp.duplicateKey"] = "Yinelenen {0}: {1}",
        ["mcp.nameExists"] = "Bu ada sahip bir sunucu zaten var",
        ["mcp.commandRequired"] = "Komut gerekli",
        ["mcp.urlRequired"] = "URL gerekli",
        ["mcp.urlInvalid"] = "URL geçerli bir http veya https adresi olmalı (ör. https://example.com)",
        ["mcp.saveFailed"] = "Kaydetme başarısız: {0}",
        ["mcp.deleteConfirm"] = "'{0}' sunucusu silinsin mi?",
        ["mcp.deleteConfirmTitle"] = "Silmeyi onayla",
        ["mcp.deleteFailed"] = "Silme başarısız: {0}",
        ["mcp.nameRequired"] = "Ad gerekli",
        ["mcp.nameTooLong"] = "Ad çok uzun",
        ["mcp.nameChars"] = "Ad yalnızca harf, rakam, '-' ve '_' içerebilir",

        ["status.thinking"] = "⟳ Claude düşünüyor…",
        ["export.empty"] = "Dışa aktarılacak bir şey yok — sohbet boş.",
        ["export.title"] = "Sohbeti Markdown olarak dışa aktar",
        ["export.filter"] = "Markdown (*.md)|*.md|Tüm dosyalar (*.*)|*.*",
        ["export.done"] = "Sohbet dışa aktarıldı: {0}",
        ["export.failed"] = "Dışa aktarma başarısız: {0}",
        ["attach.title"] = "Dosya seç",
        ["attach.filter"] = "Tüm dosyalar (*.*)|*.*|Metin dosyaları|*.txt;*.cs;*.js;*.ts;*.html;*.css;*.json;*.xml;*.md;*.py;*.cpp;*.h",
        ["toast.noEditor"] = "Aktif düzenleyici yok — önce bir dosya açın.",
        ["sideq.empty"] = "boş soru",
        ["mcp.missingServer"] = "sunucu adı eksik",
        ["rewind.noSession"] = "Aktif oturum yok.",
        ["rewind.notActive"] = "Bu oturum henüz aktif değil — önce bir mesaj gönderin, sonra geri alın.",
        ["rewind.noTranscript"] = "Oturumun konuşma kaydı bulunamadı.",
        ["rewind.readFailed"] = "Konuşma kaydı okunamadı.",
        ["rewind.notFound"] = "Bu mesaj konuşma kaydında bulunamadı.",
        ["rewind.failed"] = "Geri alma başarısız.",
        ["diff.noSolution"] = "Açık solution yok.",
        ["diff.notRepo"] = "Git deposu değil.",
        ["diff.notRepoBody"] = "Bu proje git sürüm denetimi altında değil.\n\nDiff'leri etkinleştirmek için VS'de bir depo başlatın.",
        ["diff.noCommitStat"] = " {0} dosya (henüz ilk commit yok), {1} ekleme(+)",
        ["diff.emptyRepo"] = "Depo başlatıldı ama boş.",
        ["diff.noFiles"] = "Gösterilecek izlenen veya izlenmeyen dosya yok.",
        ["diff.noChanges"] = "Son commit'ten bu yana değişiklik yok.",
        ["diff.error"] = "Diff hesaplanırken hata: {0}",
        ["cost.session"] = "oturum ${0:F2} / ${1:F2}",
        ["cost.today"] = "bugün ${0:F2} / ${1:F2}",
        ["cost.limitReached"] = "sınıra ulaşıldı",
    };
}

public sealed class LocExtension : MarkupExtension
{
    public LocExtension(string key) { Key = key; }

    [ConstructorArgument("key")]
    public string Key { get; set; }

    public override object ProvideValue(IServiceProvider serviceProvider) => new Binding($"[{Key}]") { Source = Strings.Instance, Mode = BindingMode.OneWay }.ProvideValue(serviceProvider);
}
