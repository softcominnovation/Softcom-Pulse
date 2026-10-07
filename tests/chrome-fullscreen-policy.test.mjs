import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chromeFullscreenPolicyCommand } from "../lib/client/chrome-fullscreen-policy.ts";

test("policy commands keep the exact environment origin and reject paths, credentials and injected patterns", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "https://dev-pulse.softcomtecnologia.com", "https://pulse.softcomtecnologia.com", "http://[::1]:3000"]) {
    const command = chromeFullscreenPolicyCommand([origin]);
    assert.ok(command.includes(`    '${origin}'`));
    assert.ok(command.includes("HKCU:\\Software\\Policies\\Google\\Chrome\\AutomaticFullscreenAllowedForUrls"));
    assert.ok(!command.includes("HKLM") && !command.includes("Remove-") && !command.includes("*"));
    assert.ok(!command.includes("Set-ExecutionPolicy") && !command.includes("Invoke-Expression"));
  }
  for (const value of ["*", "https://*.example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?x=1", "https://example.com/#x", "https://exa'mple.com", "https://example.com\n';Remove-Item HKCU:;'"]) {
    assert.throws(() => chromeFullscreenPolicyCommand([value]));
  }
});

test("PowerShell policy command appends, preserves existing entries and is idempotent with a simulated registry", { skip: process.platform !== "win32" }, () => {
  const command = chromeFullscreenPolicyCommand();
  const harness = `
$ErrorActionPreference = 'Stop'
$script:values = @{'1'='https://existing.example'; '3'='https://other.example'; '4'='https://DEV-PULSE.softcomtecnologia.com'}
$script:exists = $true
$script:creates = 0
$script:writes = 0
function AssertPath($value) {
  if ($value -cne 'HKCU:\\Software\\Policies\\Google\\Chrome\\AutomaticFullscreenAllowedForUrls') { throw 'Unexpected registry scope' }
}
function Test-Path { param($LiteralPath) AssertPath $LiteralPath; return $script:exists }
function Get-Item {
  param($LiteralPath)
  AssertPath $LiteralPath
  $mock = New-Object PSObject
  $mock | Add-Member ScriptMethod GetValueNames { return @($script:values.Keys) }
  $mock | Add-Member ScriptMethod GetValue { param($name) return $script:values[$name] }
  return $mock
}
function New-Item { param($Path, [switch]$Force) AssertPath $Path; $script:exists = $true; $script:creates++ }
function New-ItemProperty {
  param($LiteralPath, $Name, $Value, $PropertyType)
  AssertPath $LiteralPath
  if ($PropertyType -cne 'String' -or $script:values.ContainsKey($Name)) { throw 'Overwrite or wrong type' }
  $script:values[$Name] = $Value
  $script:writes++
}
${command} | Out-Null
${command} | Out-Null
if ($script:values.Count -ne 5 -or $script:values['1'] -cne 'https://existing.example' -or $script:values['3'] -cne 'https://other.example' -or $script:values['4'] -cne 'https://DEV-PULSE.softcomtecnologia.com' -or $script:values['2'] -cne 'http://localhost:3000' -or $script:values['5'] -cne 'https://pulse.softcomtecnologia.com' -or $script:writes -ne 2 -or $script:creates -ne 0) { throw 'Merge/idempotence failed' }
$script:exists = $false
$script:values = @{}
${command} | Out-Null
if ($script:values.Count -ne 3 -or $script:values['1'] -cne 'http://localhost:3000' -or $script:values['2'] -cne 'https://dev-pulse.softcomtecnologia.com' -or $script:values['3'] -cne 'https://pulse.softcomtecnologia.com' -or $script:creates -ne 1) { throw 'New policy failed' }
Write-Output 'policy-script-ok'
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", harness], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /policy-script-ok/);
});
