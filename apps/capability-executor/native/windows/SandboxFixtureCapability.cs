using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class SandboxFixtureCapability
{
    private const uint TOKEN_QUERY = 0x8;
    private const int TokenIntegrityLevel = 25;
    private const int TokenIsAppContainer = 29;
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, int length, out int returnLength);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    public static int Main(string[] args)
    {
        int sleep = 0;
        int stdout = 0;
        int bytes = 0;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--sleep=")) Int32.TryParse(arg.Substring(8), out sleep);
            if (arg.StartsWith("--stdout=")) Int32.TryParse(arg.Substring(9), out stdout);
            if (arg.StartsWith("--bytes=")) Int32.TryParse(arg.Substring(8), out bytes);
        }
        if (stdout > 0) Console.Out.Write(new string('x', stdout));
        string requestFile = Environment.GetEnvironmentVariable("MOOYU_CAPABILITY_REQUEST");
        string resultFile = Environment.GetEnvironmentVariable("MOOYU_CAPABILITY_RESULT");
        string outputRoot = Environment.GetEnvironmentVariable("MOOYU_CAPABILITY_OUTPUT_DIR");
        if (String.IsNullOrEmpty(requestFile) || String.IsNullOrEmpty(resultFile) || String.IsNullOrEmpty(outputRoot)) return 11;
        string request = File.ReadAllText(requestFile, Encoding.UTF8);
        Directory.CreateDirectory(outputRoot);
        if (bytes > 0) File.WriteAllBytes(Path.Combine(outputRoot, "disk.bin"), new byte[bytes]);
        if (sleep > 0) Thread.Sleep(sleep);
        bool appContainer; uint integrity;
        InspectToken(out appContainer, out integrity);
        bool networkConnected = false;
        try { using (var client = new TcpClient()) { client.Connect("127.0.0.1", 9); networkConnected = true; } } catch { }
        var serializer = new JavaScriptSerializer();
        var utf8 = new UTF8Encoding(false);
        File.WriteAllText(Path.Combine(outputRoot, "result.json"), serializer.Serialize(new {
            appContainer = appContainer, integrityRid = integrity, networkConnected = networkConnected,
            requestBytes = Encoding.UTF8.GetByteCount(request)
        }), utf8);
        File.WriteAllText(resultFile, serializer.Serialize(new {
            schemaVersion = "capability-native-result-v1",
            artifact = new { path = "result.json", mediaType = "application/json",
                metadata = new Dictionary<string, object> { { "fixture", true } } }
        }), utf8);
        return 0;
    }

    private static void InspectToken(out bool appContainer, out uint integrity)
    {
        appContainer = false; integrity = UInt32.MaxValue; IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, out token)) return;
        try
        {
            int length; IntPtr value = Marshal.AllocHGlobal(4);
            try { if (GetTokenInformation(token, TokenIsAppContainer, value, 4, out length)) appContainer = Marshal.ReadInt32(value) == 1; }
            finally { Marshal.FreeHGlobal(value); }
            GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out length);
            IntPtr label = Marshal.AllocHGlobal(length);
            try
            {
                if (GetTokenInformation(token, TokenIntegrityLevel, label, length, out length))
                {
                    IntPtr sid = Marshal.ReadIntPtr(label); int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                    integrity = (uint)Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
                }
            }
            finally { Marshal.FreeHGlobal(label); }
        }
        finally { CloseHandle(token); }
    }
}
