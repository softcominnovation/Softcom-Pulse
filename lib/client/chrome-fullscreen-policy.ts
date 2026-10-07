export const pulseFullscreenOrigins = [
  "http://localhost:3000",
  "https://dev-pulse.softcomtecnologia.com",
  "https://pulse.softcomtecnologia.com",
] as const;

export function chromeFullscreenPolicyCommand(addresses: readonly string[] = pulseFullscreenOrigins) {
  const origins = [...new Set(addresses.map(address => {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !/^[a-z0-9.\-:[\]]+$/i.test(url.hostname)) throw new Error("invalid_origin");
    return url.origin.replaceAll("'", "''");
  }))];
  return `& {
  $ErrorActionPreference = 'Stop'
  $pulseOrigins = @(
${origins.map(origin => `    '${origin}'`).join("\n")}
  )
  $pulsePolicyPath = 'HKCU:\\Software\\Policies\\Google\\Chrome\\AutomaticFullscreenAllowedForUrls'
  if (-not (Test-Path -LiteralPath $pulsePolicyPath)) {
    New-Item -Path $pulsePolicyPath -Force | Out-Null
  }
  foreach ($pulseOrigin in $pulseOrigins) {
    $pulseKey = Get-Item -LiteralPath $pulsePolicyPath
    $pulseNames = @($pulseKey.GetValueNames())
    $pulseExisting = @(
      foreach ($pulseName in $pulseNames) {
        $pulseKey.GetValue($pulseName)
      }
    )
    if ($pulseExisting -contains $pulseOrigin) {
      Write-Output ('Ja cadastrado: ' + $pulseOrigin)
      continue
    }
    $pulseSlot = 1
    while ($pulseNames -contains [string]$pulseSlot) { $pulseSlot++ }
    New-ItemProperty -LiteralPath $pulsePolicyPath -Name ([string]$pulseSlot) -Value $pulseOrigin -PropertyType String | Out-Null
    Write-Output ('Cadastrado: ' + $pulseOrigin)
  }
  Write-Output 'Confira chrome://policy e use Verificar autorizacao no Pulse.'
}`;
}
