using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// Current-user helper copied outside the install directory before shutdown.
// No elevation, shell execution, registry writes or access to account/save data.
class MooyuUpdateRunner {
  static string Hash(string file) { using(var sha=SHA256.Create()) using(var stream=File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
  static string Field(Dictionary<string,object> d,string key) { return Convert.ToString(d[key]); }
  static void CheckPath(string file) {
    if(!Path.IsPathRooted(file)||file.StartsWith(@"\\")||file.IndexOfAny(new[]{'"','\r','\n'})>=0) throw new Exception("PATH_DENIED");
  }
  static int Main(string[] args) {
    string result=null;
    try {
      if(args.Length!=1) return 2;
      CheckPath(args[0]);
      var json=new JavaScriptSerializer();
      var input=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[0],Encoding.UTF8));
      string installer=Field(input,"installer"),target=Field(input,"target"),digest=Field(input,"sha256"),exeDigest=Field(input,"exeSha256");
      result=Path.Combine(Path.GetDirectoryName(args[0]),"last-install-result.json");
      CheckPath(installer);CheckPath(target);
      if(Path.GetExtension(installer)!=".exe"||Path.GetExtension(target)!=".exe"||!System.Text.RegularExpressions.Regex.IsMatch(digest,"^[a-f0-9]{64}$")||!System.Text.RegularExpressions.Regex.IsMatch(exeDigest,"^[a-f0-9]{64}$")) throw new Exception("INPUT_DENIED");
      try { using(var owner=Process.GetProcessById(Convert.ToInt32(input["pid"]))) { if(!owner.WaitForExit(90000)) throw new Exception("APP_STILL_RUNNING"); } } catch(ArgumentException) { }
      if(Hash(installer)!=digest) throw new Exception("INSTALLER_INTEGRITY");
      using(var process=Process.Start(new ProcessStartInfo {FileName=installer,Arguments="--updated /S /D="+Path.GetDirectoryName(target),UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(installer),WindowStyle=ProcessWindowStyle.Hidden})) {
        if(!process.WaitForExit(180000)||process.ExitCode!=0) throw new Exception("INSTALL_FAILED");
      }
      if(!File.Exists(target)||Hash(target)!=exeDigest) throw new Exception("INSTALLED_EXECUTABLE_INTEGRITY");
      Process.Start(new ProcessStartInfo {FileName=target,Arguments="--updated",UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(target)});
      File.WriteAllText(result,"{\"installed\":true,\"restartRequested\":true}",Encoding.UTF8);return 0;
    } catch(Exception error) {
      if(result!=null) { try { File.WriteAllText(result,"{\"installed\":false,\"code\":\""+(System.Text.RegularExpressions.Regex.IsMatch(error.Message,"^[A-Z_]+$")?error.Message:"INSTALL_FAILED")+"\"}",Encoding.UTF8); } catch {} }
      return 1;
    }
  }
}
