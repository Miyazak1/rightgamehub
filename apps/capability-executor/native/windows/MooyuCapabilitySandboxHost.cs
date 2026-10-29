using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using System.Web.Script.Serialization;

internal static class Program
{
    private const string RequestSchema = "windows-sandbox-host-request-v4";
    private const string ResultSchema = "windows-sandbox-host-result-v1";
    private const uint TOKEN_ALL_ACCESS = 0x000F01FF;
    private const uint DISABLE_MAX_PRIVILEGE = 0x1;
    private const uint LUA_TOKEN = 0x4;
    private const uint WRITE_RESTRICTED = 0x8;
    private const uint SE_GROUP_INTEGRITY = 0x20;
    private const int TokenIntegrityLevel = 25;
    private const int TokenIsAppContainer = 29;
    private const uint CREATE_SUSPENDED = 0x4;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const int STARTF_USESTDHANDLES = 0x100;
    private const uint HANDLE_FLAG_INHERIT = 0x1;
    private const uint PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
    private const uint PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8;
    private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100;
    private const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int JobObjectCpuRateControlInformation = 15;
    private const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x1;
    private const uint JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x4;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint WAIT_TIMEOUT = 258;
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x1;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private static bool _started;

    private sealed class Request
    {
        public string schemaVersion { get; set; }
        public string requestId { get; set; }
        public string executable { get; set; }
        public string installationRoot { get; set; }
        public string[] arguments { get; set; }
        public string workingDirectory { get; set; }
        public Dictionary<string, string> environment { get; set; }
        public FileGrant[] fileGrants { get; set; }
        public FileGrant[] readOnlyResources { get; set; }
        public Permissions permissions { get; set; }
        public Resources resources { get; set; }
        public DataPolicy dataPolicy { get; set; }
        public int timeoutMs { get; set; }
        public int maxDiagnosticBytes { get; set; }
        public string cancellationFile { get; set; }
    }

    private sealed class FileGrant
    {
        public string sourcePath { get; set; }
        public string access { get; set; }
        public FileIdentity identity { get; set; }
    }
    private sealed class FileIdentity
    {
        public string schemaVersion { get; set; }
        public string volumeSerialNumber { get; set; }
        public string fileId { get; set; }
        public string sizeBytes { get; set; }
    }
    private sealed class Permissions { public string[] networkDomains { get; set; } public string[] devices { get; set; } }
    private sealed class Resources { public int cpuCores { get; set; } public int memoryMiB { get; set; } public int diskMiB { get; set; } }
    private sealed class DataPolicy { public bool localOnly { get; set; } public string upload { get; set; } }

    private sealed class AppliedRule
    {
        public string Path;
        public FileSystemAccessRule Rule;
        public bool Directory;
    }

    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_ATTRIBUTES
    { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential)] private struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_CAPABILITIES
    { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO
    {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars;
        public int dwYCountChars; public int dwFillAttribute; public int dwFlags; public short wShowWindow;
        public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION
    { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS
    { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION { public uint ControlFlags; public uint CpuRate; }
    [StructLayout(LayoutKind.Sequential)] private struct FILETIME { public uint dwLowDateTime; public uint dwHighDateTime; }
    [StructLayout(LayoutKind.Sequential)] private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint dwFileAttributes; public FILETIME ftCreationTime; public FILETIME ftLastAccessTime;
        public FILETIME ftLastWriteTime; public uint dwVolumeSerialNumber; public uint nFileSizeHigh;
        public uint nFileSizeLow; public uint nNumberOfLinks; public uint nFileIndexHigh; public uint nFileIndexLow;
    }

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool IsTokenRestricted(IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableSidCount, IntPtr sidsToDisable, uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount, IntPtr restrictedSids, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool SetTokenInformation(IntPtr token, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength, out int returnLength);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);
    [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, uint capabilityCount, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, [In] ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, UIntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES attributes, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll")] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode,
        IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out BY_HANDLE_FILE_INFORMATION information);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    public static int Main(string[] args)
    {
        if (args != null && args.Length == 1 && args[0] == "--self-test") return SelfTest();
        Request request = null;
        try
        {
            var serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
            request = serializer.Deserialize<Request>(Console.In.ReadToEnd());
            Validate(request);
            var process = Execute(request);
            Emit(new { schemaVersion = ResultSchema, requestId = request.requestId, ok = true, process = process });
            return 0;
        }
        catch (HostException error)
        {
            Emit(new { schemaVersion = ResultSchema, requestId = request == null ? null : request.requestId,
                ok = false, started = _started, errorCode = error.Code, message = error.Message, win32Error = error.Win32Error });
            return 2;
        }
        catch (Exception error)
        {
            Emit(new { schemaVersion = ResultSchema, requestId = request == null ? null : request.requestId,
                ok = false, started = _started, errorCode = "CAPABILITY_SANDBOX_HOST_INTERNAL", message = error.GetType().Name, win32Error = 0 });
            return 3;
        }
    }

    private static int SelfTest()
    {
        IntPtr currentToken = IntPtr.Zero, restrictedToken = IntPtr.Zero, appSid = IntPtr.Zero, job = IntPtr.Zero;
        string profile = "MooyuSandboxHealth" + Guid.NewGuid().ToString("N");
        try
        {
            Check(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out currentToken), "CAPABILITY_SANDBOX_SELF_TEST_TOKEN_OPEN_FAILED");
            if (!CreateRestrictedToken(currentToken, DISABLE_MAX_PRIVILEGE, 0, IntPtr.Zero, 0,
                IntPtr.Zero, 0, IntPtr.Zero, out restrictedToken) && !IsTokenRestricted(currentToken))
                ThrowLast("CAPABILITY_SANDBOX_SELF_TEST_RESTRICTED_TOKEN_FAILED");
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) ThrowLast("CAPABILITY_SANDBOX_SELF_TEST_JOB_FAILED");
            int created = CreateAppContainerProfile(profile, "Mooyu sandbox health probe",
                "Ephemeral runtime health probe", IntPtr.Zero, 0, out appSid);
            if (created != 0) throw new HostException("CAPABILITY_SANDBOX_SELF_TEST_APPCONTAINER_FAILED", created);
            Emit(new { schemaVersion = "windows-sandbox-host-self-test-v1", ok = true,
                restrictedToken = true, jobObject = true, appContainerProfile = true });
            return 0;
        }
        catch (HostException error)
        {
            Emit(new { schemaVersion = "windows-sandbox-host-self-test-v1", ok = false,
                errorCode = error.Code, win32Error = error.Win32Error });
            return 4;
        }
        catch (Exception error)
        {
            Emit(new { schemaVersion = "windows-sandbox-host-self-test-v1", ok = false,
                errorCode = "CAPABILITY_SANDBOX_SELF_TEST_INTERNAL", message = error.GetType().Name });
            return 5;
        }
        finally
        {
            if (appSid != IntPtr.Zero) FreeSid(appSid);
            DeleteAppContainerProfile(profile);
            if (job != IntPtr.Zero) CloseHandle(job);
            if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
            if (currentToken != IntPtr.Zero) CloseHandle(currentToken);
        }
    }

    private static void Validate(Request request)
    {
        if (request == null || request.schemaVersion != RequestSchema || String.IsNullOrWhiteSpace(request.requestId)
            || !Path.IsPathRooted(request.executable) || !File.Exists(request.executable)
            || !Path.IsPathRooted(request.installationRoot) || !Directory.Exists(request.installationRoot)
            || !Path.IsPathRooted(request.workingDirectory) || !Directory.Exists(request.workingDirectory)
            || !Path.IsPathRooted(request.cancellationFile) || request.arguments == null || request.environment == null
            || request.fileGrants == null || request.permissions == null || request.permissions.networkDomains == null
            || request.permissions.devices == null || request.permissions.networkDomains.Length != 0
            || request.permissions.devices.Length != 0 || request.resources == null || request.dataPolicy == null
            || !request.dataPolicy.localOnly || request.dataPolicy.upload != "never" || request.timeoutMs < 1000
            || request.maxDiagnosticBytes < 1024) throw new HostException("CAPABILITY_SANDBOX_REQUEST_INVALID", 0);
        foreach (var grant in request.fileGrants)
        {
            bool file = grant != null && File.Exists(grant.sourcePath);
            bool directory = grant != null && Directory.Exists(grant.sourcePath);
            if (grant == null || grant.access != "read" || !Path.IsPathRooted(grant.sourcePath)
                || file == directory || directory && grant.identity != null
                || file && (grant.identity == null
                    || grant.identity.schemaVersion != "windows-file-identity-v1"
                    || String.IsNullOrWhiteSpace(grant.identity.volumeSerialNumber)
                    || String.IsNullOrWhiteSpace(grant.identity.fileId)
                    || String.IsNullOrWhiteSpace(grant.identity.sizeBytes)))
                throw new HostException("CAPABILITY_SANDBOX_REQUEST_INVALID", 0);
        }
        if (request.readOnlyResources != null)
        {
            foreach (var resource in request.readOnlyResources)
            {
                bool directory = resource != null && Directory.Exists(resource.sourcePath);
                bool file = resource != null && File.Exists(resource.sourcePath);
                if (resource == null || !Path.IsPathRooted(resource.sourcePath) || file == directory
                    || directory && (resource.access != "traverse" || resource.identity != null)
                    || file && (resource.access != "read" && resource.access != "read-execute"
                        || resource.identity == null
                        || resource.identity.schemaVersion != "windows-file-identity-v1"
                        || String.IsNullOrWhiteSpace(resource.identity.volumeSerialNumber)
                        || String.IsNullOrWhiteSpace(resource.identity.fileId)
                        || String.IsNullOrWhiteSpace(resource.identity.sizeBytes)))
                    throw new HostException("CAPABILITY_SANDBOX_REQUEST_INVALID", 0);
            }
        }
    }

    private static SafeFileHandle OpenVerifiedGrant(FileGrant grant)
    {
        ulong expectedVolume, expectedFileId, expectedSize;
        if (grant.identity == null
            || !UInt64.TryParse(grant.identity.volumeSerialNumber, out expectedVolume)
            || !UInt64.TryParse(grant.identity.fileId, out expectedFileId)
            || !UInt64.TryParse(grant.identity.sizeBytes, out expectedSize))
            throw new HostException("CAPABILITY_SANDBOX_FILE_IDENTITY_INVALID", 0);
        var handle = CreateFile(grant.sourcePath, GENERIC_READ, FILE_SHARE_READ, IntPtr.Zero,
            OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (handle == null || handle.IsInvalid)
        {
            int code = Marshal.GetLastWin32Error();
            if (handle != null) handle.Dispose();
            throw new HostException("CAPABILITY_SANDBOX_FILE_IDENTITY_UNAVAILABLE", code);
        }
        BY_HANDLE_FILE_INFORMATION information;
        if (!GetFileInformationByHandle(handle, out information))
        {
            int code = Marshal.GetLastWin32Error(); handle.Dispose();
            throw new HostException("CAPABILITY_SANDBOX_FILE_IDENTITY_UNAVAILABLE", code);
        }
        ulong actualFileId = ((ulong)information.nFileIndexHigh << 32) | information.nFileIndexLow;
        ulong actualSize = ((ulong)information.nFileSizeHigh << 32) | information.nFileSizeLow;
        if ((information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
            || information.dwVolumeSerialNumber != expectedVolume
            || actualFileId != expectedFileId || actualSize != expectedSize)
        {
            handle.Dispose();
            throw new HostException("CAPABILITY_SANDBOX_FILE_IDENTITY_CHANGED", 0);
        }
        return handle;
    }

    private static object Execute(Request request)
    {
        IntPtr currentToken = IntPtr.Zero, restrictedToken = IntPtr.Zero, appSid = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, securityBuffer = IntPtr.Zero, handlesBuffer = IntPtr.Zero, environment = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero, job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        var rules = new List<AppliedRule>();
        var grantHandles = new List<SafeFileHandle>();
        string appContainerName = null;
        try
        {
            Check(OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out currentToken), "CAPABILITY_SANDBOX_TOKEN_OPEN_FAILED");
            if (!CreateRestrictedToken(currentToken, DISABLE_MAX_PRIVILEGE, 0, IntPtr.Zero, 0,
                IntPtr.Zero, 0, IntPtr.Zero, out restrictedToken))
            {
                if (!IsTokenRestricted(currentToken)) ThrowLast("CAPABILITY_SANDBOX_TOKEN_CREATE_FAILED");
                restrictedToken = currentToken;
                currentToken = IntPtr.Zero;
            }
            appContainerName = "mooyu.capability." + request.requestId.Replace("-", "");
            int createProfile = CreateAppContainerProfile(appContainerName, "Mooyu isolated capability", "Ephemeral capability sandbox", IntPtr.Zero, 0, out appSid);
            if (createProfile != 0 || appSid == IntPtr.Zero) throw new HostException("CAPABILITY_SANDBOX_APPCONTAINER_FAILED", createProfile);
            var identity = new SecurityIdentifier(appSid);
            AddRule(request.installationRoot, true, identity, FileSystemRights.ReadAndExecute, rules);
            AddRule(request.workingDirectory, true, identity, FileSystemRights.Modify | FileSystemRights.ReadAndExecute, rules);
            foreach (var grant in request.fileGrants)
            {
                bool directory = Directory.Exists(grant.sourcePath);
                if (!directory) grantHandles.Add(OpenVerifiedGrant(grant));
                AddRule(grant.sourcePath, directory, identity, FileSystemRights.ReadAndExecute, rules);
            }
            if (request.readOnlyResources != null)
            {
                foreach (var resource in request.readOnlyResources)
                {
                    bool directory = Directory.Exists(resource.sourcePath);
                    if (!directory) grantHandles.Add(OpenVerifiedGrant(resource));
                    var rights = resource.access == "read-execute"
                        ? FileSystemRights.ReadAndExecute
                        : directory ? FileSystemRights.ReadAndExecute : FileSystemRights.Read;
                    AddRule(resource.sourcePath, directory, identity, rights, rules, false);
                }
            }

            var pipeAttributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = true };
            Check(CreatePipe(out outputRead, out outputWrite, ref pipeAttributes, 0), "CAPABILITY_SANDBOX_PIPE_FAILED");
            Check(CreatePipe(out errorRead, out errorWrite, ref pipeAttributes, 0), "CAPABILITY_SANDBOX_PIPE_FAILED");
            Check(SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0) && SetHandleInformation(errorRead, HANDLE_FLAG_INHERIT, 0), "CAPABILITY_SANDBOX_PIPE_FAILED");

            IntPtr attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeSize);
            attributes = Marshal.AllocHGlobal(attributeSize);
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref attributeSize), "CAPABILITY_SANDBOX_ATTRIBUTES_FAILED");
            var security = new SECURITY_CAPABILITIES { AppContainerSid = appSid, Capabilities = IntPtr.Zero, CapabilityCount = 0, Reserved = 0 };
            securityBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
            Marshal.StructureToPtr(security, securityBuffer, false);
            Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES), securityBuffer, new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))), IntPtr.Zero, IntPtr.Zero), "CAPABILITY_SANDBOX_ATTRIBUTES_FAILED");
            handlesBuffer = Marshal.AllocHGlobal(IntPtr.Size * 2);
            Marshal.WriteIntPtr(handlesBuffer, 0, outputWrite); Marshal.WriteIntPtr(handlesBuffer, IntPtr.Size, errorWrite);
            Check(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handlesBuffer, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero), "CAPABILITY_SANDBOX_ATTRIBUTES_FAILED");

            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) ThrowLast("CAPABILITY_SANDBOX_JOB_CREATE_FAILED");
            ConfigureJob(job, request.resources);
            environment = BuildEnvironment(request);
            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = IntPtr.Zero;
            startup.StartupInfo.hStdOutput = outputWrite;
            startup.StartupInfo.hStdError = errorWrite;
            startup.lpAttributeList = attributes;
            var commandLine = new StringBuilder(BuildCommandLine(request.executable, request.arguments));
            Check(CreateProcessAsUser(restrictedToken, request.executable, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                environment, request.workingDirectory, ref startup, out process), "CAPABILITY_SANDBOX_PROCESS_CREATE_FAILED");
            _started = true;
            Check(AssignProcessToJobObject(job, process.hProcess), "CAPABILITY_SANDBOX_JOB_ASSIGN_FAILED");
            VerifyProcessToken(process.hProcess);
            if (ResumeThread(process.hThread) == UInt32.MaxValue) ThrowLast("CAPABILITY_SANDBOX_PROCESS_RESUME_FAILED");
            Close(ref outputWrite); Close(ref errorWrite);
            var outputCounter = CountPipe(outputRead, request.maxDiagnosticBytes, job);
            var errorCounter = CountPipe(errorRead, request.maxDiagnosticBytes, job);
            string reason = "exited";
            var watch = Stopwatch.StartNew();
            while (true)
            {
                if (request.resources.diskMiB > 0 && DirectoryBytesExceed(request.workingDirectory, (long)request.resources.diskMiB * 1024L * 1024L))
                { reason = "disk-limit"; TerminateJobObject(job, 0xD15C); break; }
                uint wait = WaitForSingleObject(process.hProcess, 100);
                if (wait == WAIT_OBJECT_0)
                {
                    if (outputCounter.Exceeded || errorCounter.Exceeded) reason = "diagnostic-limit";
                    else if (request.resources.diskMiB > 0 && DirectoryBytesExceed(request.workingDirectory, (long)request.resources.diskMiB * 1024L * 1024L)) reason = "disk-limit";
                    break;
                }
                if (wait != WAIT_TIMEOUT) ThrowLast("CAPABILITY_SANDBOX_PROCESS_WAIT_FAILED");
                if (File.Exists(request.cancellationFile)) { reason = "cancelled"; TerminateJobObject(job, 0xC000013A); break; }
                if (watch.ElapsedMilliseconds >= request.timeoutMs) { reason = "timeout"; TerminateJobObject(job, 0x102); break; }
                if (outputCounter.Exceeded || errorCounter.Exceeded)
                { reason = "diagnostic-limit"; TerminateJobObject(job, 0xDEAD); break; }
            }
            WaitForSingleObject(process.hProcess, 5000);
            uint exitCode; if (!GetExitCodeProcess(process.hProcess, out exitCode)) exitCode = 1;
            long outputBytes = outputCounter.Finish(); long errorBytes = errorCounter.Finish();
            return new { exitCode = unchecked((int)exitCode), terminationReason = reason, stdoutBytes = outputBytes, stderrBytes = errorBytes };
        }
        finally
        {
            foreach (var handle in grantHandles) handle.Dispose();
            Close(ref outputRead); Close(ref outputWrite); Close(ref errorRead); Close(ref errorWrite);
            Close(ref process.hThread); Close(ref process.hProcess); Close(ref job);
            if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
            if (securityBuffer != IntPtr.Zero) Marshal.FreeHGlobal(securityBuffer);
            if (handlesBuffer != IntPtr.Zero) Marshal.FreeHGlobal(handlesBuffer);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            Close(ref restrictedToken); Close(ref currentToken);
            if (appSid != IntPtr.Zero) FreeSid(appSid);
            if (appContainerName != null) DeleteAppContainerProfile(appContainerName);
            for (int index = rules.Count - 1; index >= 0; index--) RemoveRule(rules[index]);
        }
    }

    [DllImport("advapi32.dll", SetLastError = true)] private static extern int GetLengthSid(IntPtr sid);

    private static void ConfigureJob(IntPtr job, Resources resources)
    {
        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        limits.BasicLimitInformation.ActiveProcessLimit = 8;
        if (resources.memoryMiB > 0) { limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY; limits.ProcessMemoryLimit = new UIntPtr((ulong)resources.memoryMiB * 1024UL * 1024UL); }
        SetJob(job, JobObjectExtendedLimitInformation, limits, "CAPABILITY_SANDBOX_JOB_LIMIT_FAILED");
        if (resources.cpuCores > 0)
        {
            uint rate = (uint)Math.Max(1, Math.Min(10000, resources.cpuCores * 10000 / Math.Max(1, Environment.ProcessorCount)));
            var cpu = new JOBOBJECT_CPU_RATE_CONTROL_INFORMATION { ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP, CpuRate = rate };
            SetJob(job, JobObjectCpuRateControlInformation, cpu, "CAPABILITY_SANDBOX_JOB_LIMIT_FAILED");
        }
    }

    private static void SetJob<T>(IntPtr job, int infoClass, T value, string code)
    {
        int size = Marshal.SizeOf(typeof(T)); IntPtr buffer = Marshal.AllocHGlobal(size);
        try { Marshal.StructureToPtr(value, buffer, false); Check(SetInformationJobObject(job, infoClass, buffer, (uint)size), code); }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static void VerifyProcessToken(IntPtr process)
    {
        IntPtr token; Check(OpenProcessToken(process, TOKEN_ALL_ACCESS, out token), "CAPABILITY_SANDBOX_VERIFY_FAILED");
        try
        {
            int length; IntPtr value = Marshal.AllocHGlobal(4);
            try { Check(GetTokenInformation(token, TokenIsAppContainer, value, 4, out length), "CAPABILITY_SANDBOX_VERIFY_FAILED"); if (Marshal.ReadInt32(value) != 1) throw new HostException("CAPABILITY_SANDBOX_VERIFY_FAILED", 0); }
            finally { Marshal.FreeHGlobal(value); }
            GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out length);
            IntPtr label = Marshal.AllocHGlobal(length);
            try
            {
                Check(GetTokenInformation(token, TokenIntegrityLevel, label, length, out length), "CAPABILITY_SANDBOX_VERIFY_FAILED");
                IntPtr sid = Marshal.ReadIntPtr(label); int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                uint rid = (uint)Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
                if (rid > 4096) throw new HostException("CAPABILITY_SANDBOX_VERIFY_FAILED", 0);
            }
            finally { Marshal.FreeHGlobal(label); }
        }
        finally { CloseHandle(token); }
    }

    private static IntPtr BuildEnvironment(Request request)
    {
        var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string[] inherited = { "ALLUSERSPROFILE", "APPDATA", "ComSpec", "LOCALAPPDATA", "PATH",
            "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "SystemDrive", "SystemRoot", "USERPROFILE", "WINDIR" };
        foreach (string name in inherited)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (!String.IsNullOrEmpty(value)) values[name] = value;
        }
        values["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows";
        values["TEMP"] = request.workingDirectory; values["TMP"] = request.workingDirectory;
        foreach (var pair in request.environment) values[pair.Key] = pair.Value;
        var builder = new StringBuilder(); foreach (var pair in values) builder.Append(pair.Key).Append('=').Append(pair.Value).Append('\0'); builder.Append('\0');
        return Marshal.StringToHGlobalUni(builder.ToString());
    }

    private static string BuildCommandLine(string executable, string[] arguments)
    {
        var builder = new StringBuilder(Quote(executable)); foreach (var argument in arguments) builder.Append(' ').Append(Quote(argument)); return builder.ToString();
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"'); return result.ToString();
    }

    private static void AddRule(string target, bool directory, SecurityIdentifier identity, FileSystemRights rights, List<AppliedRule> applied, bool inherit = true)
    {
        var inheritance = directory && inherit ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        var rule = new FileSystemAccessRule(identity, rights, inheritance, PropagationFlags.None, AccessControlType.Allow);
        if (directory) { var security = Directory.GetAccessControl(target); security.AddAccessRule(rule); Directory.SetAccessControl(target, security); }
        else { var security = File.GetAccessControl(target); security.AddAccessRule(rule); File.SetAccessControl(target, security); }
        applied.Add(new AppliedRule { Path = target, Rule = rule, Directory = directory });
    }

    private static void RemoveRule(AppliedRule applied)
    {
        try
        {
            if (applied.Directory) { var security = Directory.GetAccessControl(applied.Path); security.RemoveAccessRuleSpecific(applied.Rule); Directory.SetAccessControl(applied.Path, security); }
            else { var security = File.GetAccessControl(applied.Path); security.RemoveAccessRuleSpecific(applied.Rule); File.SetAccessControl(applied.Path, security); }
        }
        catch { }
    }

    private sealed class PipeCounter
    {
        private long _count;
        private volatile bool _exceeded;
        private readonly Task<long> _task;
        public PipeCounter(IntPtr handle, int maximum, IntPtr job)
        {
            var safe = new SafeFileHandle(handle, false);
            _task = Task.Run<long>(() => { var buffer = new byte[8192]; using (var stream = new FileStream(safe, FileAccess.Read, 8192, false)) { int read; while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) { long value = Interlocked.Add(ref _count, read); if (value > maximum) { _exceeded = true; TerminateJobObject(job, 0xDEAD); } } } return _count; });
        }
        public bool Exceeded { get { return _exceeded; } }
        public long Finish() { return _task.GetAwaiter().GetResult(); }
    }

    private static PipeCounter CountPipe(IntPtr handle, int maximum, IntPtr job)
    {
        return new PipeCounter(handle, maximum, job);
    }

    private static bool DirectoryBytesExceed(string root, long maximum)
    {
        long total = 0;
        var pending = new Stack<string>(); pending.Push(root);
        while (pending.Count > 0)
        {
            string current = pending.Pop();
            foreach (string file in Directory.GetFiles(current))
            {
                var info = new FileInfo(file);
                if ((info.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                total += info.Length; if (total > maximum) return true;
            }
            foreach (string directory in Directory.GetDirectories(current))
            {
                var info = new DirectoryInfo(directory);
                if ((info.Attributes & FileAttributes.ReparsePoint) == 0) pending.Push(directory);
            }
        }
        return false;
    }

    private static void Emit(object value)
    {
        try { Console.Out.Write(new JavaScriptSerializer().Serialize(value)); }
        catch { Console.Out.Write("{\"schemaVersion\":\"windows-sandbox-host-result-v1\",\"ok\":false,\"errorCode\":\"CAPABILITY_SANDBOX_SERIALIZE_FAILED\"}"); }
    }

    private static void Check(bool success, string code) { if (!success) ThrowLast(code); }
    private static void ThrowLast(string code) { throw new HostException(code, Marshal.GetLastWin32Error()); }
    private static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }

    private sealed class HostException : Exception
    {
        public readonly string Code; public readonly int Win32Error;
        public HostException(string code, int win32Error) : base(code) { Code = code; Win32Error = win32Error; }
    }
}
