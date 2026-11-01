using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;

internal static class DesktopPreviewLauncher {
    [STAThread] private static void Main() {
        try {
            string config = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launch.json");
            var settings = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(config, Encoding.UTF8));
            string executable = (string)settings["electronExecutable"], entry = (string)settings["electronEntry"];
            foreach (string file in new[] { executable, entry, config }) if (!Path.IsPathRooted(file) || file.Contains("\"") || !File.Exists(file)) throw new InvalidDataException();
            using (var stream = File.OpenRead(executable)) using (var sha = SHA256.Create())
                if (BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant() != "bd14928e0728366fd3f41499cb398ff3f4304dab259a3e605077899a6f8c748e") throw new InvalidDataException();
            var start = new ProcessStartInfo(executable, "\"" + entry + "\" --config \"" + config + "\"") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(executable) };
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(start);
        } catch { System.Windows.Forms.MessageBox.Show("本地预览尚未准备好，请先运行仓库中的 start-mooyu-desktop-preview.bat。", "墨鱼工坊开发预览"); }
    }
}
