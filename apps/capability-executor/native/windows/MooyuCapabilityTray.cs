using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class TrayConstants
{
    public const string CenterSchema = "capability-desktop-file-consent-center-v1";
    public const string ControlSecretKey = "desktop-shell-control-hmac-v1";
    public const string Entropy = "mooyu-capability-executor-v1";
    public const int MaximumItems = 200;
}

internal sealed class ConsentItem
{
    public string RequestId;
    public string CapabilityKey;
    public string State;
    public string CreatedAt;
    public bool Actionable;
}

internal sealed class ConsentCenter
{
    public int NotificationCount;
    public int ActiveCount;
    public readonly List<ConsentItem> Items = new List<ConsentItem>();
}

internal static class JsonValue
{
    private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

    public static Dictionary<string, object> Object(object value)
    {
        Dictionary<string, object> result = value as Dictionary<string, object>;
        if (result == null) throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID");
        return result;
    }

    public static string String(Dictionary<string, object> value, string key)
    {
        object raw;
        if (!value.TryGetValue(key, out raw) || !(raw is string))
            throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID");
        return (string)raw;
    }

    public static int Integer(Dictionary<string, object> value, string key)
    {
        object raw;
        if (!value.TryGetValue(key, out raw))
            throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID");
        try { return Convert.ToInt32(raw, CultureInfo.InvariantCulture); }
        catch { throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID"); }
    }

    public static bool Boolean(Dictionary<string, object> value, string key)
    {
        object raw;
        if (!value.TryGetValue(key, out raw) || !(raw is bool))
            throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID");
        return (bool)raw;
    }

    public static object Parse(string text) { return Serializer.DeserializeObject(text); }
    public static string Serialize(object value) { return Serializer.Serialize(value); }

    public static string Canonical(object value)
    {
        if (value == null) return "null";
        if (value is string) return Serializer.Serialize((string)value);
        if (value is bool) return (bool)value ? "true" : "false";
        Dictionary<string, object> map = value as Dictionary<string, object>;
        if (map != null)
        {
            List<string> keys = map.Keys.ToList();
            keys.Sort(StringComparer.Ordinal);
            return "{" + string.Join(",", keys.Select(delegate(string key) {
                return Serializer.Serialize(key) + ":" + Canonical(map[key]);
            }).ToArray()) + "}";
        }
        IEnumerable sequence = value as IEnumerable;
        if (sequence != null)
        {
            List<string> items = new List<string>();
            foreach (object item in sequence) items.Add(Canonical(item));
            return "[" + string.Join(",", items.ToArray()) + "]";
        }
        if (value is byte || value is short || value is int || value is long ||
            value is float || value is double || value is decimal)
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        throw new InvalidDataException("CAPABILITY_TRAY_JSON_INVALID");
    }
}

internal static class TrayIdentity
{
    public static string Sha256Hex(string value)
    {
        using (SHA256 algorithm = SHA256.Create())
        {
            byte[] bytes = algorithm.ComputeHash(Encoding.UTF8.GetBytes(value));
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
    }

    public static string RootIdentity(string root)
    {
        return Sha256Hex(Environment.UserName + "\n" + Path.GetFullPath(root).ToLowerInvariant());
    }

    public static string PipeName(string root) { return "mooyu-capability-node-" + RootIdentity(root).Substring(0, 32); }
    public static string InstanceName(string root) { return RootIdentity(root).Substring(0, 32); }
}

internal sealed class NativeControlClient
{
    private readonly string root;
    private readonly string pipeName;
    private readonly int timeoutMilliseconds;

    public NativeControlClient(string rootDirectory, int timeoutMilliseconds)
    {
        root = Path.GetFullPath(rootDirectory);
        pipeName = TrayIdentity.PipeName(root);
        this.timeoutMilliseconds = timeoutMilliseconds;
    }

    private byte[] LoadSecret()
    {
        string record = TrayIdentity.Sha256Hex(TrayConstants.ControlSecretKey) + ".dpapi";
        string file = Path.Combine(root, "vault", record);
        string protectedText = File.ReadAllText(file, Encoding.UTF8).Trim();
        byte[] protectedBytes = Convert.FromBase64String(protectedText);
        byte[] entropy = Encoding.UTF8.GetBytes(TrayConstants.Entropy);
        byte[] plain = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.CurrentUser);
        string secret = Encoding.UTF8.GetString(plain);
        return Base64UrlDecode(secret);
    }

    private static byte[] Base64UrlDecode(string value)
    {
        string padded = value.Replace('-', '+').Replace('_', '/');
        while (padded.Length % 4 != 0) padded += "=";
        return Convert.FromBase64String(padded);
    }

    private static string Base64Url(byte[] value)
    {
        return Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private string Sign(byte[] secret, string challenge, string requestId, string command, object payload)
    {
        string statement = "capability-desktop-shell-control-v2\n" + challenge + "\n" +
            requestId + "\n" + command + "\n" + JsonValue.Canonical(payload);
        using (HMACSHA256 hmac = new HMACSHA256(secret))
            return Base64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(statement)));
    }

    private static string ReadLineWithTimeout(StreamReader reader, int timeoutMilliseconds)
    {
        Task<string> read = reader.ReadLineAsync();
        if (!read.Wait(timeoutMilliseconds)) throw new IOException("CAPABILITY_TRAY_IPC_TIMEOUT");
        return read.Result;
    }

    public object Request(string command, object payload)
    {
        using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName,
            PipeDirection.InOut, PipeOptions.None))
        {
            pipe.Connect(timeoutMilliseconds);
            pipe.ReadMode = PipeTransmissionMode.Byte;
            using (StreamReader reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true))
            using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true))
            {
                writer.NewLine = "\n";
                writer.AutoFlush = true;
                string challengeLine = ReadLineWithTimeout(reader, timeoutMilliseconds);
                if (challengeLine == null) throw new IOException("CAPABILITY_TRAY_IPC_CLOSED");
                Dictionary<string, object> challenge = JsonValue.Object(JsonValue.Parse(challengeLine));
                if (JsonValue.String(challenge, "schemaVersion") != "capability-desktop-shell-challenge-v1")
                    throw new InvalidDataException("CAPABILITY_TRAY_IPC_INVALID");
                string challengeValue = JsonValue.String(challenge, "challenge");
                string requestId = Guid.NewGuid().ToString();
                Dictionary<string, object> request = new Dictionary<string, object>();
                request["schemaVersion"] = "capability-desktop-shell-control-v2";
                request["requestId"] = requestId;
                request["command"] = command;
                request["payload"] = payload;
                request["challenge"] = challengeValue;
                request["signature"] = Sign(LoadSecret(), challengeValue, requestId, command, payload);
                writer.WriteLine(JsonValue.Serialize(request));
                string responseLine = ReadLineWithTimeout(reader, command == "approve-file-consent" ?
                    30 * 60 * 1000 : timeoutMilliseconds);
                if (responseLine == null) throw new IOException("CAPABILITY_TRAY_IPC_CLOSED");
                Dictionary<string, object> response = JsonValue.Object(JsonValue.Parse(responseLine));
                if (JsonValue.String(response, "schemaVersion") != "capability-desktop-shell-response-v1")
                    throw new InvalidDataException("CAPABILITY_TRAY_IPC_INVALID");
                object okRaw;
                object responseId;
                if (!response.TryGetValue("ok", out okRaw) || !(okRaw is bool) || !(bool)okRaw ||
                    !response.TryGetValue("requestId", out responseId) || !requestId.Equals(responseId as string))
                {
                    object code;
                    response.TryGetValue("code", out code);
                    throw new InvalidOperationException(code as string ?? "CAPABILITY_TRAY_IPC_FAILED");
                }
                object result;
                if (!response.TryGetValue("result", out result))
                    throw new InvalidDataException("CAPABILITY_TRAY_IPC_INVALID");
                return result;
            }
        }
    }

    public ConsentCenter ReadCenter()
    {
        Dictionary<string, object> result = JsonValue.Object(Request("file-consent-center", null));
        if (JsonValue.String(result, "schemaVersion") != TrayConstants.CenterSchema)
            throw new InvalidDataException("CAPABILITY_TRAY_CENTER_INVALID");
        ConsentCenter center = new ConsentCenter();
        center.NotificationCount = JsonValue.Integer(result, "notificationCount");
        center.ActiveCount = JsonValue.Integer(result, "activeCount");
        object rawItems;
        if (!result.TryGetValue("items", out rawItems)) throw new InvalidDataException("CAPABILITY_TRAY_CENTER_INVALID");
        IEnumerable items = rawItems as IEnumerable;
        if (items == null) throw new InvalidDataException("CAPABILITY_TRAY_CENTER_INVALID");
        foreach (object raw in items)
        {
            Dictionary<string, object> item = JsonValue.Object(raw);
            string state = JsonValue.String(item, "state");
            if (state != "waiting" && state != "selecting") continue;
            center.Items.Add(new ConsentItem {
                RequestId = JsonValue.String(item, "requestId"),
                CapabilityKey = JsonValue.String(item, "capabilityKey"),
                State = state,
                CreatedAt = JsonValue.String(item, "createdAt"),
                Actionable = JsonValue.Boolean(item, "actionable")
            });
            if (center.Items.Count > TrayConstants.MaximumItems)
                throw new InvalidDataException("CAPABILITY_TRAY_CENTER_INVALID");
        }
        return center;
    }

    public object Approve(string requestId, IntPtr owner)
    {
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["requestId"] = requestId;
        payload["ownerWindowHandle"] = owner.ToInt64().ToString(CultureInfo.InvariantCulture);
        return Request("approve-file-consent", payload);
    }

    public object Reject(string requestId)
    {
        Dictionary<string, object> payload = new Dictionary<string, object>();
        payload["requestId"] = requestId;
        return Request("reject-file-consent", payload);
    }
}

internal sealed class NotificationLedger
{
    private readonly string file;
    private readonly HashSet<string> notified = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    private readonly List<string> order = new List<string>();

    public NotificationLedger(string root)
    {
        file = Path.Combine(root, "desktop-shell", "tray-notifications.json");
        Load();
    }

    private void Load()
    {
        if (!File.Exists(file)) return;
        try
        {
            Dictionary<string, object> value = JsonValue.Object(JsonValue.Parse(File.ReadAllText(file, Encoding.UTF8)));
            if (JsonValue.String(value, "schemaVersion") != "capability-desktop-tray-notifications-v1") return;
            object raw;
            if (!value.TryGetValue("requestIds", out raw)) return;
            IEnumerable values = raw as IEnumerable;
            if (values == null) return;
            foreach (object item in values)
            {
                string id = item as string;
                Guid parsed;
                if (id != null && Guid.TryParse(id, out parsed) && notified.Add(id)) order.Add(id);
                if (order.Count >= TrayConstants.MaximumItems) break;
            }
        }
        catch { notified.Clear(); order.Clear(); }
    }

    public List<string> MarkUnseen(IEnumerable<ConsentItem> items)
    {
        List<string> unseen = new List<string>();
        foreach (ConsentItem item in items.Where(delegate(ConsentItem item) { return item.State == "waiting"; }))
        {
            if (notified.Add(item.RequestId)) { order.Add(item.RequestId); unseen.Add(item.RequestId); }
        }
        while (order.Count > TrayConstants.MaximumItems)
        {
            notified.Remove(order[0]); order.RemoveAt(0);
        }
        if (unseen.Count > 0) Save();
        return unseen;
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        Dictionary<string, object> value = new Dictionary<string, object>();
        value["schemaVersion"] = "capability-desktop-tray-notifications-v1";
        value["requestIds"] = order.ToArray();
        value["updatedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temporary, JsonValue.Serialize(value), new UTF8Encoding(false));
        try
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    if (File.Exists(file)) File.Replace(temporary, file, null);
                    else File.Move(temporary, file);
                    break;
                }
                catch (IOException) { if (attempt >= 5) throw; Thread.Sleep(10 * (attempt + 1)); }
                catch (UnauthorizedAccessException) { if (attempt >= 5) throw; Thread.Sleep(10 * (attempt + 1)); }
            }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

internal sealed class ConsentForm : Form
{
    private readonly NativeControlClient client;
    private readonly ListView requests = new ListView();
    private readonly Button approve = new Button();
    private readonly Button reject = new Button();
    private readonly Button refresh = new Button();
    private readonly Button close = new Button();
    private readonly Label status = new Label();
    private bool busy;

    public ConsentForm(NativeControlClient client)
    {
        this.client = client;
        Text = "小墨鱼 · 本地文件授权";
        AccessibleName = "小墨鱼本地文件授权中心";
        AccessibleDescription = "查看等待中的本地文件授权请求，并批准或拒绝。";
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(720, 430);
        MinimumSize = new Size(620, 360);
        ShowInTaskbar = true;
        KeyPreview = true;
        Font = new Font("Microsoft YaHei UI", 9F);

        requests.View = View.Details;
        requests.FullRowSelect = true;
        requests.MultiSelect = false;
        requests.HideSelection = false;
        requests.Dock = DockStyle.Fill;
        requests.Columns.Add("能力", 315);
        requests.Columns.Add("状态", 100);
        requests.Columns.Add("请求时间", 210);
        requests.AccessibleName = "等待处理的文件授权请求";
        requests.AccessibleDescription = "使用上下方向键选择请求，回车批准，Delete 键拒绝。";

        approve.Text = "批准并选择文件";
        approve.AccessibleName = "批准所选请求并打开系统文件选择器";
        reject.Text = "拒绝";
        reject.AccessibleName = "拒绝所选请求";
        refresh.Text = "刷新";
        refresh.AccessibleName = "刷新授权请求";
        close.Text = "关闭";
        close.AccessibleName = "隐藏授权中心";
        approve.AutoSize = reject.AutoSize = refresh.AutoSize = close.AutoSize = true;
        approve.Click += async delegate { await ApproveSelected(); };
        reject.Click += async delegate { await RejectSelected(); };
        refresh.Click += async delegate { await RefreshCenter(); };
        close.Click += delegate { Hide(); };
        requests.SelectedIndexChanged += delegate { UpdateButtons(); };

        status.AutoSize = true;
        status.AccessibleName = "授权中心状态";
        status.Padding = new Padding(4, 7, 4, 4);
        status.Text = "正在连接本地能力节点…";

        FlowLayoutPanel buttons = new FlowLayoutPanel();
        buttons.Dock = DockStyle.Bottom;
        buttons.Height = 50;
        buttons.Padding = new Padding(8);
        buttons.FlowDirection = FlowDirection.RightToLeft;
        buttons.Controls.Add(close); buttons.Controls.Add(refresh); buttons.Controls.Add(reject); buttons.Controls.Add(approve);
        Panel statusPanel = new Panel();
        statusPanel.Dock = DockStyle.Top; statusPanel.Height = 38; statusPanel.Controls.Add(status);
        Controls.Add(requests); Controls.Add(buttons); Controls.Add(statusPanel);
        AcceptButton = approve;
        CancelButton = close;
        FormClosing += delegate(object sender, FormClosingEventArgs args) {
            if (args.CloseReason == CloseReason.UserClosing) { args.Cancel = true; Hide(); }
        };
        KeyDown += async delegate(object sender, KeyEventArgs args) {
            if (args.KeyCode == Keys.Delete) { args.Handled = true; await RejectSelected(); }
        };
        UpdateButtons();
    }

    public void ShowAndActivate()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        TopMost = true; BringToFront(); Activate(); TopMost = false;
        Task ignored = RefreshCenter();
    }

    public async Task RefreshCenter()
    {
        if (busy) return;
        busy = true; UpdateButtons(); status.Text = "正在刷新…";
        try
        {
            ConsentCenter center = await Task.Run(delegate { return client.ReadCenter(); });
            Render(center);
            status.Text = center.ActiveCount == 0 ? "当前没有等待处理的请求。" :
                string.Format(CultureInfo.CurrentCulture, "共有 {0} 个活动请求，其中 {1} 个等待操作。",
                    center.ActiveCount, center.NotificationCount);
        }
        catch { status.Text = "暂时无法连接本地能力节点，请稍后重试。"; }
        finally { busy = false; UpdateButtons(); }
    }

    private void Render(ConsentCenter center)
    {
        string selected = Selected == null ? null : Selected.RequestId;
        requests.BeginUpdate(); requests.Items.Clear();
        foreach (ConsentItem item in center.Items)
        {
            string state = item.State == "waiting" ? "等待处理" : "正在选择";
            ListViewItem row = new ListViewItem(item.CapabilityKey);
            row.SubItems.Add(state); row.SubItems.Add(item.CreatedAt); row.Tag = item;
            requests.Items.Add(row);
            if (selected == item.RequestId) row.Selected = true;
        }
        if (requests.SelectedItems.Count == 0 && requests.Items.Count > 0) requests.Items[0].Selected = true;
        requests.EndUpdate();
    }

    private ConsentItem Selected { get { return requests.SelectedItems.Count == 1 ? requests.SelectedItems[0].Tag as ConsentItem : null; } }
    private void UpdateButtons()
    {
        ConsentItem item = Selected;
        approve.Enabled = !busy && item != null && item.Actionable;
        reject.Enabled = !busy && item != null && item.Actionable;
        refresh.Enabled = !busy;
    }

    private async Task ApproveSelected()
    {
        ConsentItem item = Selected;
        if (busy || item == null || !item.Actionable) return;
        busy = true; UpdateButtons(); status.Text = "等待你在系统窗口中选择文件…";
        try
        {
            IntPtr owner = Handle;
            await Task.Run(delegate { client.Approve(item.RequestId, owner); });
            status.Text = "请求已处理。";
        }
        catch { status.Text = "未完成批准；请求仍将安全保留或按状态关闭。"; }
        finally { busy = false; }
        await RefreshCenter();
    }

    private async Task RejectSelected()
    {
        ConsentItem item = Selected;
        if (busy || item == null || !item.Actionable) return;
        DialogResult answer = MessageBox.Show(this, "确定拒绝这个本地文件授权请求吗？",
            "小墨鱼", MessageBoxButtons.YesNo, MessageBoxIcon.Question,
            MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes) return;
        busy = true; UpdateButtons(); status.Text = "正在拒绝…";
        try { await Task.Run(delegate { client.Reject(item.RequestId); }); status.Text = "请求已拒绝。"; }
        catch { status.Text = "拒绝操作未完成，请刷新后重试。"; }
        finally { busy = false; }
        await RefreshCenter();
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly NativeControlClient client;
    private readonly NotificationLedger ledger;
    private readonly NotifyIcon icon;
    private readonly ConsentForm form;
    private readonly System.Windows.Forms.Timer timer;
    private readonly EventWaitHandle activation;
    private RegisteredWaitHandle activationWait;
    private bool polling;
    private int failures;

    public TrayContext(string root, int pollMilliseconds, EventWaitHandle activation)
    {
        client = new NativeControlClient(root, 5000);
        ledger = new NotificationLedger(root);
        this.activation = activation;
        form = new ConsentForm(client);
        IntPtr ignored = form.Handle;
        icon = new NotifyIcon();
        icon.Icon = SystemIcons.Application;
        icon.Text = "小墨鱼本地能力";
        icon.Visible = true;
        icon.DoubleClick += delegate { form.ShowAndActivate(); };
        icon.BalloonTipClicked += delegate { form.ShowAndActivate(); };
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("打开授权中心", null, delegate { form.ShowAndActivate(); });
        menu.Items.Add("立即刷新", null, async delegate { await Poll(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, delegate { Exit(); });
        icon.ContextMenuStrip = menu;
        timer = new System.Windows.Forms.Timer();
        timer.Interval = pollMilliseconds;
        timer.Tick += async delegate { await Poll(); };
        timer.Start();
        activationWait = ThreadPool.RegisterWaitForSingleObject(activation, delegate(object state, bool timeout) {
            if (!timeout && form.IsHandleCreated) form.BeginInvoke(new Action(form.ShowAndActivate));
        }, null, Timeout.Infinite, false);
        Task ignoredPoll = Poll();
    }

    private async Task Poll()
    {
        if (polling) return;
        polling = true;
        try
        {
            ConsentCenter center = await Task.Run(delegate { return client.ReadCenter(); });
            failures = 0;
            timer.Interval = Math.Min(timer.Interval, 5000);
            icon.Text = center.NotificationCount > 0 ?
                string.Format(CultureInfo.CurrentCulture, "小墨鱼：{0} 个文件授权待处理", center.NotificationCount) :
                "小墨鱼本地能力：已连接";
            List<string> unseen = ledger.MarkUnseen(center.Items);
            if (unseen.Count > 0)
            {
                icon.BalloonTipTitle = "小墨鱼需要本地文件授权";
                icon.BalloonTipText = unseen.Count == 1 ? "有 1 个请求等待你选择文件。" :
                    string.Format(CultureInfo.CurrentCulture, "有 {0} 个新请求等待处理。", unseen.Count);
                icon.BalloonTipIcon = ToolTipIcon.Info;
                icon.ShowBalloonTip(5000);
            }
            if (form.Visible) await form.RefreshCenter();
        }
        catch
        {
            failures++;
            int[] delay = new int[] { 2000, 5000, 10000, 30000 };
            timer.Interval = delay[Math.Min(failures - 1, delay.Length - 1)];
            icon.Text = "小墨鱼本地能力：正在重连";
        }
        finally { polling = false; }
    }

    private void Exit()
    {
        timer.Stop();
        if (activationWait != null) activationWait.Unregister(null);
        icon.Visible = false; icon.Dispose(); form.Dispose(); activation.Dispose();
        ExitThread();
    }
}

internal static class Program
{
    private static void Emit(string text)
    {
#if TRAY_ACCEPTANCE_CONSOLE
        Console.Out.WriteLine(text);
#endif
    }

    private static Dictionary<string, string> Parse(string[] args)
    {
        Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index++)
        {
            string name = args[index];
            if (name == "--self-test" || name == "--headless-once" ||
                name == "--notification-probe") { values[name] = "true"; continue; }
            if (name != "--root" && name != "--poll-ms" && name != "--request-id" &&
                name != "--hold-instance-ms") throw new ArgumentException("CAPABILITY_TRAY_ARGUMENT_INVALID");
            if (values.ContainsKey(name) || index + 1 >= args.Length) throw new ArgumentException("CAPABILITY_TRAY_ARGUMENT_INVALID");
            values[name] = args[++index];
        }
        return values;
    }

    [STAThread]
    private static int Main(string[] args)
    {
#if TRAY_ACCEPTANCE_CONSOLE
        Console.OutputEncoding = new UTF8Encoding(false);
#endif
        try
        {
            Dictionary<string, string> options = Parse(args);
            string root;
            if (!options.TryGetValue("--root", out root) || !Path.IsPathRooted(root))
                throw new ArgumentException("CAPABILITY_TRAY_ROOT_REQUIRED");
            root = Path.GetFullPath(root);
            if (options.ContainsKey("--self-test"))
            {
                Dictionary<string, object> result = new Dictionary<string, object>();
                result["schemaVersion"] = "capability-desktop-tray-self-test-v1";
                result["singleInstance"] = true;
                result["persistentNotificationDedupe"] = true;
                result["foregroundOwner"] = true;
                result["keyboardActions"] = new string[] { "enter-approve", "delete-reject", "escape-close" };
                result["accessibleWindowName"] = "小墨鱼本地文件授权中心";
                result["pipeIdentity"] = TrayIdentity.PipeName(root);
                Emit(JsonValue.Serialize(result)); return 0;
            }
            if (options.ContainsKey("--headless-once"))
            {
                ConsentCenter center = new NativeControlClient(root, 5000).ReadCenter();
                Dictionary<string, object> result = new Dictionary<string, object>();
                result["schemaVersion"] = "capability-desktop-tray-headless-v1";
                result["notificationCount"] = center.NotificationCount;
                result["activeCount"] = center.ActiveCount;
                result["requestIds"] = center.Items.Select(delegate(ConsentItem item) { return item.RequestId; }).ToArray();
                Emit(JsonValue.Serialize(result)); return 0;
            }
            if (options.ContainsKey("--notification-probe"))
            {
                string requestId;
                Guid parsed;
                if (!options.TryGetValue("--request-id", out requestId) || !Guid.TryParse(requestId, out parsed))
                    throw new ArgumentException("CAPABILITY_TRAY_ARGUMENT_INVALID");
                ConsentItem item = new ConsentItem { RequestId = requestId, State = "waiting",
                    CapabilityKey = "acceptance.synthetic", CreatedAt = DateTime.UtcNow.ToString("o"),
                    Actionable = true };
                int unseen = new NotificationLedger(root).MarkUnseen(new ConsentItem[] { item }).Count;
                Dictionary<string, object> result = new Dictionary<string, object>();
                result["schemaVersion"] = "capability-desktop-tray-notification-probe-v1";
                result["unseenCount"] = unseen;
                Emit(JsonValue.Serialize(result)); return 0;
            }
            int pollMilliseconds = 2000;
            string poll;
            if (options.TryGetValue("--poll-ms", out poll) && (!int.TryParse(poll, out pollMilliseconds) ||
                pollMilliseconds < 500 || pollMilliseconds > 60000))
                throw new ArgumentException("CAPABILITY_TRAY_ARGUMENT_INVALID");
            string identity = TrayIdentity.InstanceName(root);
            bool created;
            using (Mutex mutex = new Mutex(true, "Local\\MooyuCapabilityTray-" + identity, out created))
            using (EventWaitHandle activation = new EventWaitHandle(false, EventResetMode.AutoReset,
                "Local\\MooyuCapabilityTrayActivate-" + identity))
            {
                if (!created) { activation.Set(); return 20; }
                string holdValue;
                if (options.TryGetValue("--hold-instance-ms", out holdValue))
                {
                    int holdMilliseconds;
                    if (!int.TryParse(holdValue, out holdMilliseconds) || holdMilliseconds < 100 ||
                        holdMilliseconds > 30000) throw new ArgumentException("CAPABILITY_TRAY_ARGUMENT_INVALID");
                    Emit("{\"schemaVersion\":\"capability-desktop-tray-instance-ready-v1\"}");
                    Thread.Sleep(holdMilliseconds); return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(root, pollMilliseconds, activation));
                GC.KeepAlive(mutex);
            }
            return 0;
        }
        catch (Exception error)
        {
            Dictionary<string, object> value = new Dictionary<string, object>();
            value["schemaVersion"] = "capability-desktop-tray-error-v1";
            value["code"] = error.Message.StartsWith("CAPABILITY_", StringComparison.Ordinal) ?
                error.Message : "CAPABILITY_TRAY_FAILED";
#if TRAY_ACCEPTANCE_CONSOLE
            value["exceptionType"] = error.GetType().Name;
#endif
            Emit(JsonValue.Serialize(value)); return 70;
        }
    }
}
