using System;

internal static class SshAskPass
{
    private static void Main()
    {
        Console.Write(Environment.GetEnvironmentVariable("VELA_SSH_PASSWORD") ?? string.Empty);
    }
}
