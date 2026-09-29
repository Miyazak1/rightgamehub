// Experimental Windows-only bridge. It owns one trusted game process tree.
// No desktop capture, global input injection, window reparenting, or shell commands.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class WindowBridge {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] struct GuiInfo { public int size,flags; public IntPtr active,focus,capture,menu,move,caret; public Rect caretRect; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
    public uint size,usage,pid; public IntPtr heap; public uint module,threads,parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
  }
  delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hwnd,ref Point point);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder name,int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code,uint kind);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hwnd,int command);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint length);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32First(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32Next(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  const string DeskcatHash = "4967f9e183a311193f8b2f0fd33f5a40b8b2a1ff7a575c2d412b2e4640c69912";
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static object gate = new object();
  static HashSet<int> owned = new HashSet<int>();
  static Dictionary<int,DateTime> identities = new Dictionary<int,DateTime>();
  static HashSet<int> pressed = new HashSet<int>();
  static bool leftDown=false, running=true;
  static IntPtr window=IntPtr.Zero, mouseTarget=IntPtr.Zero;
  static int width,height,lastX,lastY;
  static long frameId=0,inputId=0;
  static void Emit(object value) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
  static bool Owns(IntPtr target) { uint pid; GetWindowThreadProcessId(target,out pid); return owned.Contains((int)pid) && SameProcess((int)pid); }
  static bool SameProcess(int pid) { try { return identities.ContainsKey(pid) && Process.GetProcessById(pid).StartTime.ToUniversalTime()==identities[pid]; } catch { return false; } }
  static void Remember(int pid) { try { var p=Process.GetProcessById(pid); var started=p.StartTime.ToUniversalTime(); owned.Add(pid); identities[pid]=started; } catch {} }
  static void Discover() {
    var snap=CreateToolhelp32Snapshot(2,0); if(snap==new IntPtr(-1)) return;
    var rows=new List<ProcessEntry>();
    try { var row=new ProcessEntry(); row.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
      if(Process32First(snap,ref row)) do { rows.Add(row); } while(Process32Next(snap,ref row));
    } finally { CloseHandle(snap); }
    for(int pass=0;pass<5;pass++) foreach(var row in rows)
      if(!owned.Contains((int)row.pid) && owned.Contains((int)row.parent) && SameProcess((int)row.parent)) Remember((int)row.pid);
    if(window!=IntPtr.Zero && IsWindow(window) && Owns(window)) return;
    window=IntPtr.Zero;
    EnumWindows(delegate(IntPtr candidate,IntPtr unused) {
      Rect rect;
      if(Owns(candidate) && IsWindowVisible(candidate) && GetClientRect(candidate,out rect) && rect.R>300 && rect.B>300) { window=candidate; return false; }
      return true;
    },IntPtr.Zero);
    if(window==IntPtr.Zero) return;
    mouseTarget=window;
    EnumChildWindows(window,delegate(IntPtr child,IntPtr unused) {
      var cls=new StringBuilder(256); GetClassName(child,cls,256);
      if(Owns(child) && cls.ToString()=="Chrome_RenderWidgetHostHWND") mouseTarget=child;
      return true;
    },IntPtr.Zero);
    uint gamePid; GetWindowThreadProcessId(window,out gamePid);
    Emit(new {type="window",pid=gamePid,hwnd=window.ToInt64(),child=mouseTarget.ToInt64()});
  }
  static IntPtr KeyTarget() {
    uint pid; uint thread=GetWindowThreadProcessId(window,out pid);
    var info=new GuiInfo(); info.size=Marshal.SizeOf(typeof(GuiInfo));
    if(GetGUIThreadInfo(thread,ref info) && info.focus!=IntPtr.Zero && Owns(info.focus)) return info.focus;
    return mouseTarget;
  }
  static void RefreshInputTarget() {
    mouseTarget=window;
    EnumChildWindows(window,delegate(IntPtr child,IntPtr unused) {
      var cls=new StringBuilder(256); GetClassName(child,cls,256);
      if(Owns(child) && cls.ToString()=="Chrome_RenderWidgetHostHWND") mouseTarget=child;
      return true;
    },IntPtr.Zero);
  }
  static void Mouse(uint msg,int x,int y) {
    if(window==IntPtr.Zero || !Owns(window) || !Owns(mouseTarget)) return;
    var p=new Point {X=x,Y=y}; ClientToScreen(window,ref p); ScreenToClient(mouseTarget,ref p);
    PostMessage(mouseTarget,msg,new IntPtr(leftDown?1:0),new IntPtr((p.Y<<16)|(p.X&65535)));
  }
  static void Key(int vk,bool down) {
    var target=KeyTarget(); if(target==IntPtr.Zero || !Owns(target)) return;
    uint flags=1|(MapVirtualKey((uint)vk,0)<<16);
    if(vk>=33 && vk<=46) flags|=1u<<24;
    if(!down) flags|=0xc0000000;
    PostMessage(target,down?0x100u:0x101u,new IntPtr(vk),new IntPtr(unchecked((int)flags)));
  }
  static void Release() { foreach(int vk in pressed) Key(vk,false); pressed.Clear(); leftDown=false; Mouse(0x202,lastX,lastY); }
  static void Commands() {
    try { string line; while((line=Console.ReadLine())!=null) {
      if(line.Length>2048) continue;
      var c=json.Deserialize<Dictionary<string,object>>(line);
      lock(gate) {
        string kind=Convert.ToString(c["type"]);
        if(kind=="stop") { running=false; return; }
        if(kind=="release") { Release(); continue; }
        if(window==IntPtr.Zero || !Owns(window)) continue;
        RefreshInputTarget();
        if(kind!="mouse" || Convert.ToString(c["action"])!="move") Emit(new {type="input-queued",kind=kind,target=mouseTarget.ToInt64(),foregroundBefore=Owns(GetForegroundWindow())});
        if(kind=="window") {
          Release(); ShowWindowAsync(window,Convert.ToString(c["action"])=="minimize"?6:4);
        } else if(kind=="mouse") {
          int x=Math.Max(0,Math.Min(width-1,Convert.ToInt32(c["x"]))), y=Math.Max(0,Math.Min(height-1,Convert.ToInt32(c["y"])));
          lastX=x; lastY=y; string action=Convert.ToString(c["action"]);
          if(action=="down") { leftDown=true; Mouse(0x201,x,y); }
          else if(action=="up") { leftDown=false; Mouse(0x202,x,y); }
          else if(action=="move") Mouse(0x200,x,y);
        } else if(kind=="key") {
          int vk=Convert.ToInt32(c["vk"]); if(vk<8 || vk>222 || vk==91 || vk==92 || vk==18 || vk==115 || vk==122) continue;
          bool down=Convert.ToBoolean(c["down"]); Key(vk,down); if(down) pressed.Add(vk); else pressed.Remove(vk);
        } else if(kind=="text") {
          string value=Convert.ToString(c["text"]); if(value.Length>32) continue;
          var target=KeyTarget(); if(Owns(target)) foreach(char ch in value) if(ch>=32) PostMessage(target,0x102,new IntPtr(ch),new IntPtr(1));
        }
        inputId++;
      }
    } } catch(Exception e) { lock(gate) Emit(new {type="command-error",message=e.Message}); }
    finally { running=false; }
  }
  static void Capture() {
    Rect rect; if(window==IntPtr.Zero || !Owns(window) || !GetClientRect(window,out rect)) return;
    width=rect.R; height=rect.B; if(width<1 || height<1 || width>4096 || height>4096) return;
    var watch=Stopwatch.StartNew();
    using(var bitmap=new Bitmap(width,height,PixelFormat.Format24bppRgb)) {
      bool ok;
      using(var graphics=Graphics.FromImage(bitmap)) {
        var dc=graphics.GetHdc(); try { ok=PrintWindow(window,dc,3); } finally { graphics.ReleaseHdc(dc); }
      }
      if(!ok) { Emit(new {type="capture-error",message="PrintWindow returned false"}); return; }
      using(var stream=new MemoryStream()) {
        bitmap.Save(stream,ImageFormat.Jpeg);
        Emit(new {type="frame",id=++frameId,input=inputId,width=width,height=height,ms=watch.ElapsedMilliseconds,
          foregroundIsGame=Owns(GetForegroundWindow()),minimized=IsIconic(window),jpeg=Convert.ToBase64String(stream.ToArray())});
      }
    }
  }
  static int Main(string[] args) {
    IntPtr job=IntPtr.Zero;
    try {
      if(args.Length!=2) throw new Exception("Usage: WindowBridge.exe <verified-deskcat-download.exe> <isolated-user-data-dir>");
      string file=Path.GetFullPath(args[0]), profile=Path.GetFullPath(args[1]);
      using(var f=File.OpenRead(file)) using(var sha=SHA256.Create())
        if(BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant()!=DeskcatHash) throw new Exception("This probe only authorizes the supplied Deskcat SHA256.");
      if(profile.IndexOf('"')>=0) throw new Exception("Invalid profile path");
      Directory.CreateDirectory(profile);
      SetProcessDPIAware();
      job=CreateJobObject(IntPtr.Zero,null);
      var limits=Marshal.AllocHGlobal(144);
      try {
        for(int n=0;n<144;n++) Marshal.WriteByte(limits,n,0);
        Marshal.WriteInt32(limits,16,0x2000); // x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION: KILL_ON_JOB_CLOSE.
        if(job==IntPtr.Zero || !SetInformationJobObject(job,9,limits,144)) throw new Exception("Could not establish the owned process job");
      } finally { Marshal.FreeHGlobal(limits); }
      var info=new ProcessStartInfo(file,"--user-data-dir=\""+profile+"\"") {UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(file)};
      var game=Process.Start(info); Remember(game.Id);
      if(!AssignProcessToJobObject(job,game.Handle)) { game.Kill(); throw new Exception("Could not contain the game process tree"); }
      Emit(new {type="started",pid=game.Id,sha256=DeskcatHash});
      var input=new Thread(Commands); input.IsBackground=true; input.Start();
      var started=Stopwatch.StartNew();
      bool rootExitReported=false;
      while(running && started.Elapsed.TotalMinutes<30) {
        lock(gate) { Discover(); Capture(); }
        if(!rootExitReported && game.HasExited) { rootExitReported=true; lock(gate) Emit(new {type="launcher-exit",code=game.ExitCode,owned=owned.Count}); }
        if(started.Elapsed.TotalSeconds>45 && window==IntPtr.Zero) throw new Exception("No owned game window appeared");
        Thread.Sleep(90);
      }
      return 0;
    } catch(Exception e) { lock(gate) Emit(new {type="error",message=e.Message}); return 1; }
    finally { lock(gate) {
      Release();
      if(window!=IntPtr.Zero && Owns(window)) PostMessage(window,0x10,IntPtr.Zero,IntPtr.Zero);
    }
      Thread.Sleep(750);
      foreach(int pid in owned) try { if(SameProcess(pid)) Process.GetProcessById(pid).Kill(); } catch {}
      if(job!=IntPtr.Zero) CloseHandle(job);
    }
  }
}
