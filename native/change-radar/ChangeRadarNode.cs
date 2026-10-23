using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("MOOYU Change Radar Local Node")]
[assembly: AssemblyProduct("MOOYU Change Radar")]
[assembly: AssemblyVersion("0.1.0.0")]

namespace Mooyu.ChangeRadar {
  sealed class NodeConfig {
    public string PlatformUrl { get; set; }
    public string NodeToken { get; set; }
    public string DeepSeekApiKey { get; set; }
    public string Model { get; set; }
  }

  static class LocalConfigStore {
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("mooyu-change-radar-local-node-v1");
    static string DirectoryPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MOOYU", "ChangeRadar"); } }
    static string FilePath { get { return Path.Combine(DirectoryPath, "node.config"); } }

    public static NodeConfig Load() {
      if (!File.Exists(FilePath)) return new NodeConfig { PlatformUrl = "https://mooyu.fun", Model = "deepseek-chat" };
      try {
        byte[] encrypted = File.ReadAllBytes(FilePath);
        byte[] plain = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
        NodeConfig value = new JavaScriptSerializer().Deserialize<NodeConfig>(Encoding.UTF8.GetString(plain));
        Array.Clear(plain, 0, plain.Length);
        return value ?? new NodeConfig { PlatformUrl = "https://mooyu.fun", Model = "deepseek-chat" };
      } catch {
        return new NodeConfig { PlatformUrl = "https://mooyu.fun", Model = "deepseek-chat" };
      }
    }

    public static void Save(NodeConfig value) {
      Directory.CreateDirectory(DirectoryPath);
      byte[] plain = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value));
      byte[] encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
      try { File.WriteAllBytes(FilePath, encrypted); }
      finally { Array.Clear(plain, 0, plain.Length); Array.Clear(encrypted, 0, encrypted.Length); }
    }
  }

  static class EmbeddedRuntime {
    const string NodeResource = "Mooyu.ChangeRadar.node.exe";
    const string WorkerResource = "Mooyu.ChangeRadar.worker.mjs";
    static string Root { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MOOYU", "ChangeRadar", "runtime", "0.1.0"); } }
    public static string NodePath { get { return Path.Combine(Root, "node.exe"); } }
    public static string WorkerPath { get { return Path.Combine(Root, "worker.mjs"); } }

    static string Hash(Stream stream) {
      using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    static void Extract(string resourceName, string target) {
      Assembly assembly = Assembly.GetExecutingAssembly();
      using (Stream source = assembly.GetManifestResourceStream(resourceName)) {
        if (source == null) throw new InvalidOperationException("安装包缺少运行组件：" + resourceName);
        string expected = Hash(source); source.Position = 0;
        if (File.Exists(target)) {
          using (FileStream existing = File.OpenRead(target)) if (Hash(existing) == expected) return;
        }
        string temporary = target + ".new";
        using (FileStream output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None)) source.CopyTo(output);
        if (File.Exists(target)) File.Delete(target);
        File.Move(temporary, target);
      }
    }

    public static void Ensure() {
      Directory.CreateDirectory(Root);
      Extract(NodeResource, NodePath);
      Extract(WorkerResource, WorkerPath);
    }
  }

  sealed class MainForm : Form {
    readonly Color Ink = Color.FromArgb(25, 23, 31);
    readonly Color Muted = Color.FromArgb(98, 91, 112);
    readonly Color Purple = Color.FromArgb(119, 77, 244);
    readonly TextBox platform = new TextBox();
    readonly TextBox nodeToken = new TextBox();
    readonly TextBox apiKey = new TextBox();
    readonly TextBox model = new TextBox();
    readonly Label status = new Label();
    readonly RichTextBox log = new RichTextBox();
    readonly Button start = new Button();
    readonly Button stop = new Button();
    Process worker;

    public MainForm() {
      Text = "墨鱼变更雷达 · 本地节点";
      Font = new Font("Microsoft YaHei UI", 9F);
      BackColor = Color.FromArgb(246, 245, 249);
      ForeColor = Ink;
      StartPosition = FormStartPosition.CenterScreen;
      MinimumSize = new Size(720, 650);
      ClientSize = new Size(760, 690);
      AutoScaleMode = AutoScaleMode.Dpi;
      FormClosing += delegate { StopWorker(); };

      Panel header = new Panel { Dock = DockStyle.Top, Height = 114, BackColor = Color.White, Padding = new Padding(28, 22, 28, 16) };
      Label kicker = new Label { Text = "MOOYU · LOCAL RESEARCH NODE", ForeColor = Purple, AutoSize = true, Font = new Font(Font.FontFamily, 8F, FontStyle.Bold), Location = new Point(28, 20) };
      Label title = new Label { Text = "让变更雷达在这台电脑上分析", ForeColor = Ink, AutoSize = true, Font = new Font(Font.FontFamily, 18F, FontStyle.Bold), Location = new Point(25, 44) };
      Label lead = new Label { Text = "模型调用和密钥留在本机；平台只分发冻结证据并接收结构化结果。", ForeColor = Muted, AutoSize = true, Location = new Point(28, 80) };
      header.Controls.Add(kicker); header.Controls.Add(title); header.Controls.Add(lead);

      TableLayoutPanel body = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28, 20, 28, 24), ColumnCount = 1, RowCount = 7 };
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 304));
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 8));
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
      body.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
      body.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));

      Panel config = BuildConfigPanel();
      FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 2, 0, 2) };
      Button save = MakeButton("保存配置", false); save.Click += delegate { SaveConfig(true); };
      Button health = MakeButton("测试连接", false); health.Click += async delegate { await RunHealthCheck(); };
      start.Text = "启动本地节点"; StyleButton(start, true); start.Click += delegate { StartWorker(); };
      stop.Text = "停止"; StyleButton(stop, false); stop.Enabled = false; stop.Click += delegate { StopWorker(); };
      actions.Controls.Add(start); actions.Controls.Add(stop); actions.Controls.Add(health); actions.Controls.Add(save);

      status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleLeft; status.ForeColor = Muted; status.Text = "● 尚未启动";
      Label logTitle = new Label { Dock = DockStyle.Fill, Text = "运行记录", Font = new Font(Font, FontStyle.Bold), TextAlign = ContentAlignment.BottomLeft };
      log.Dock = DockStyle.Fill; log.ReadOnly = true; log.BorderStyle = BorderStyle.FixedSingle; log.BackColor = Color.FromArgb(20, 18, 25); log.ForeColor = Color.FromArgb(232, 228, 240); log.Font = new Font("Cascadia Mono", 9F); log.DetectUrls = false;
      Label foot = new Label { Dock = DockStyle.Fill, Text = "关闭窗口会停止节点。本程序不需要管理员权限，也不会开放入站端口。", ForeColor = Muted, TextAlign = ContentAlignment.BottomLeft };
      body.Controls.Add(config, 0, 0); body.Controls.Add(actions, 0, 1); body.Controls.Add(status, 0, 2); body.Controls.Add(new Panel(), 0, 3); body.Controls.Add(logTitle, 0, 4); body.Controls.Add(log, 0, 5); body.Controls.Add(foot, 0, 6);
      Controls.Add(body); Controls.Add(header);
      LoadConfig();
    }

    Panel BuildConfigPanel() {
      Panel panel = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(18) };
      TableLayoutPanel grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 5 };
      grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 142)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
      for (int i = 0; i < 4; i++) grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
      grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
      ConfigureInput(platform); ConfigureInput(nodeToken); ConfigureInput(apiKey); ConfigureInput(model);
      nodeToken.UseSystemPasswordChar = true; apiKey.UseSystemPasswordChar = true;
      AddField(grid, 0, "平台地址", platform, "只接受 HTTPS/HTTP 的站点根地址");
      AddField(grid, 1, "节点密钥", nodeToken, "在变更雷达页面创建节点后只显示一次");
      AddField(grid, 2, "DeepSeek API Key", apiKey, "使用你自己的账号，仅加密保存在当前 Windows 用户下");
      AddField(grid, 3, "模型", model, "默认 deepseek-chat");
      CheckBox reveal = new CheckBox { Text = "显示密钥", AutoSize = true, ForeColor = Muted, Padding = new Padding(0, 6, 0, 0) };
      reveal.CheckedChanged += delegate { nodeToken.UseSystemPasswordChar = !reveal.Checked; apiKey.UseSystemPasswordChar = !reveal.Checked; };
      grid.Controls.Add(reveal, 1, 4); panel.Controls.Add(grid); return panel;
    }

    void ConfigureInput(TextBox box) { box.Dock = DockStyle.Top; box.Height = 30; box.BorderStyle = BorderStyle.FixedSingle; box.Font = new Font(Font.FontFamily, 10F); }
    void AddField(TableLayoutPanel grid, int row, string label, TextBox input, string hint) {
      Label name = new Label { Text = label, Dock = DockStyle.Fill, TextAlign = ContentAlignment.TopLeft, Font = new Font(Font, FontStyle.Bold), Padding = new Padding(0, 7, 0, 0) };
      Panel holder = new Panel { Dock = DockStyle.Fill }; Label note = new Label { Text = hint, Dock = DockStyle.Bottom, Height = 20, ForeColor = Muted, Font = new Font(Font.FontFamily, 8F) };
      holder.Controls.Add(input); holder.Controls.Add(note); grid.Controls.Add(name, 0, row); grid.Controls.Add(holder, 1, row);
    }

    Button MakeButton(string text, bool primary) { Button button = new Button { Text = text }; StyleButton(button, primary); return button; }
    void StyleButton(Button button, bool primary) { button.AutoSize = true; button.Height = 34; button.FlatStyle = FlatStyle.Flat; button.FlatAppearance.BorderSize = 1; button.Margin = new Padding(0, 0, 8, 0); button.Padding = new Padding(14, 5, 14, 5); button.BackColor = primary ? Purple : Color.White; button.ForeColor = primary ? Color.White : Ink; button.FlatAppearance.BorderColor = primary ? Purple : Color.FromArgb(208, 204, 216); }

    void LoadConfig() { NodeConfig value = LocalConfigStore.Load(); platform.Text = value.PlatformUrl ?? "https://mooyu.fun"; nodeToken.Text = value.NodeToken ?? ""; apiKey.Text = value.DeepSeekApiKey ?? ""; model.Text = value.Model ?? "deepseek-chat"; }
    NodeConfig ReadConfig() {
      Uri origin; string url = platform.Text.Trim().TrimEnd('/');
      if (!Uri.TryCreate(url, UriKind.Absolute, out origin) || (origin.Scheme != "https" && origin.Scheme != "http") || origin.PathAndQuery != "/") throw new InvalidOperationException("平台地址必须是 HTTP/HTTPS 站点根地址，例如 https://mooyu.fun");
      if (Encoding.UTF8.GetByteCount(nodeToken.Text.Trim()) < 32) throw new InvalidOperationException("节点密钥无效，请从变更雷达页面重新创建本地节点。");
      if (apiKey.Text.Trim().Length < 8) throw new InvalidOperationException("请填写有效的 DeepSeek API Key。");
      if (model.Text.Trim().Length < 1 || model.Text.Trim().Length > 80) throw new InvalidOperationException("模型名称无效。");
      return new NodeConfig { PlatformUrl = origin.GetLeftPart(UriPartial.Authority), NodeToken = nodeToken.Text.Trim(), DeepSeekApiKey = apiKey.Text.Trim(), Model = model.Text.Trim() };
    }

    NodeConfig SaveConfig(bool notify) { NodeConfig value = ReadConfig(); LocalConfigStore.Save(value); if (notify) Append("配置已用 Windows 当前用户密钥加密保存。"); return value; }
    ProcessStartInfo CreateStartInfo(NodeConfig value, bool health) {
      EmbeddedRuntime.Ensure();
      ProcessStartInfo info = new ProcessStartInfo(EmbeddedRuntime.NodePath, "\"" + EmbeddedRuntime.WorkerPath + "\"" + (health ? " --health" : ""));
      info.WorkingDirectory = Path.GetDirectoryName(EmbeddedRuntime.WorkerPath); info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
      info.EnvironmentVariables["RESEARCHER_PLATFORM_URL"] = value.PlatformUrl; info.EnvironmentVariables["RESEARCHER_NODE_TOKEN"] = value.NodeToken; info.EnvironmentVariables["RESEARCHER_DEEPSEEK_API_KEY"] = value.DeepSeekApiKey; info.EnvironmentVariables["RESEARCHER_DEEPSEEK_MODEL"] = value.Model;
      return info;
    }

    async Task RunHealthCheck() {
      try {
        NodeConfig value = SaveConfig(false); SetStatus("● 正在测试连接…", Purple); ToggleActions(false);
        string output = await Task.Run(delegate {
          using (Process probe = new Process { StartInfo = CreateStartInfo(value, true) }) { probe.Start(); string stdout = probe.StandardOutput.ReadToEnd(); string stderr = probe.StandardError.ReadToEnd(); if (!probe.WaitForExit(25000)) { try { probe.Kill(); } catch {} throw new InvalidOperationException("连接测试超时。"); } if (probe.ExitCode != 0) throw new InvalidOperationException(stderr.Trim().Length > 0 ? stderr.Trim() : "连接测试失败。"); return stdout.Trim(); }
        });
        Append("连接成功：" + output); SetStatus("● 平台连接正常", Color.FromArgb(36, 145, 94));
      } catch (Exception error) { Append("连接失败：" + error.Message); SetStatus("● 连接失败", Color.FromArgb(190, 57, 64)); }
      finally { ToggleActions(true); }
    }

    void StartWorker() {
      if (worker != null && !worker.HasExited) return;
      try {
        NodeConfig value = SaveConfig(false); SetStatus("● 正在准备本地运行组件…", Purple); Application.DoEvents();
        worker = new Process { StartInfo = CreateStartInfo(value, false), EnableRaisingEvents = true };
        worker.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (!String.IsNullOrWhiteSpace(e.Data)) Append(e.Data); };
        worker.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (!String.IsNullOrWhiteSpace(e.Data)) Append(e.Data); };
        worker.Exited += delegate { BeginInvoke((Action)delegate { SetStatus("● 节点已停止", Muted); ToggleActions(true); }); };
        worker.Start(); worker.BeginOutputReadLine(); worker.BeginErrorReadLine();
        start.Enabled = false; stop.Enabled = true; SetStatus("● 正在本机轮询研究任务", Color.FromArgb(36, 145, 94)); Append("本地节点已启动。空闲时只进行轻量轮询。");
      } catch (Exception error) { worker = null; Append("启动失败：" + error.Message); SetStatus("● 启动失败", Color.FromArgb(190, 57, 64)); ToggleActions(true); }
    }

    void StopWorker() { if (worker == null) return; try { if (!worker.HasExited) worker.Kill(); } catch {} finally { worker.Dispose(); worker = null; start.Enabled = true; stop.Enabled = false; } }
    void ToggleActions(bool enabled) { start.Enabled = enabled && (worker == null || worker.HasExited); stop.Enabled = worker != null && !worker.HasExited; }
    void SetStatus(string text, Color color) { status.Text = text; status.ForeColor = color; }
    void Append(string value) { if (InvokeRequired) { BeginInvoke((Action<string>)Append, value); return; } log.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + value + Environment.NewLine); log.SelectionStart = log.TextLength; log.ScrollToCaret(); }
  }

  static class Program {
    [STAThread]
    static void Main() {
      Application.EnableVisualStyles();
      Application.SetCompatibleTextRenderingDefault(false);
      Application.Run(new MainForm());
    }
  }
}
