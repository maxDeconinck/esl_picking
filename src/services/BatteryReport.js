const escapeHtml = value => String(value ?? 'Non renseigné')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export function buildBatteryReport(devices) {
  const sortedDevices = [...devices].sort((a, b) => a.battery - b.battery);
  const subject = `[ESL] ${devices.length} pile(s) à changer`;
  const introduction = `${devices.length} étiquette(s) ont une batterie inférieure à 10 %. Merci de remplacer leurs piles.`;
  const text = [
    'Bonjour,', '', introduction, '',
    ...sortedDevices.map(device =>
      `ID : ${device.id ?? 'Non renseigné'} | MAC : ${device.mac ?? 'Non renseigné'} | Emplacement : ${device.emplacement ?? 'Non renseigné'} | Batterie : ${device.battery} %`
    ),
    '', 'Rapport hebdomadaire ESL Picking.'
  ].join('\n');
  const rows = sortedDevices.map(device => `<tr>${[
    device.id, device.mac, device.emplacement, `${device.battery} %`
  ].map(value => `<td style="padding:8px;border:1px solid #ccc">${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  const html = `<p>Bonjour,</p><p>${escapeHtml(introduction)}</p>
<table style="border-collapse:collapse"><thead><tr><th>ID</th><th>MAC</th><th>Emplacement</th><th>Batterie</th></tr></thead><tbody>${rows}</tbody></table>
<p>Rapport hebdomadaire ESL Picking.</p>`;
  return { subject, text, html };
}
