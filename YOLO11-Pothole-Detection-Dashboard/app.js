import { apiBlob, apiRequest, getAccessToken, setAccessToken } from './api-client.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = (message) => {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 3500);
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value)) : '—';
const formatCount = (value) => Number(value || 0).toLocaleString();

let recentJobs = [];
let currentDetectionId = null;
let selectedDetectionId = null;
let detectionImageObjectUrls = [];
let selectedFiles = [];
let selectedLocation = null;
let moduleRequestId = 0;

function setServiceStatus(selector, connected, label) {
  const indicator = $(selector);
  if (!indicator) return;
  indicator.className = connected ? 'connected' : 'not-connected';
  indicator.innerHTML = `<i></i>${escapeHtml(label)}`;
}

async function refreshServiceStatus() {
  const button = $('#refreshStatus');
  if (button) button.textContent = '↻ Checking…';
  try {
    const [api, database, model] = await Promise.all([
      apiRequest('/health'), apiRequest('/health/database'), apiRequest('/health/model'),
    ]);
    setServiceStatus('#backendStatus', api.status === 'ok', api.status === 'ok' ? 'Operational' : 'Unavailable');
    setServiceStatus('#databaseStatus', database.database === 'connected', database.database === 'connected' ? 'Connected' : 'Unavailable');
    const ready = model.status === 'ready';
    const modelLabel = ready ? 'Ready' : model.status === 'not_configured' ? 'Model not configured' : model.status === 'not_found' ? 'Weights not found' : model.status;
    setServiceStatus('#modelStatus', ready, modelLabel);
    if (button) button.textContent = '↻ Refresh';
    return { api, database, model };
  } catch {
    setServiceStatus('#backendStatus', false, 'Not connected');
    setServiceStatus('#databaseStatus', false, 'Unavailable');
    setServiceStatus('#modelStatus', false, 'Unavailable');
    if (button) button.textContent = '↻ Retry';
    return null;
  }
}

function renderActivity() {
  const body = $('#activityTable');
  if (!body) return;
  const query = $('#globalSearch').value.toLowerCase().trim();
  const selectedStatus = $('#statusFilter').value;
  const filtered = recentJobs.filter((job) => {
    const searchable = `${job.job_id} ${job.filename} ${job.status}`.toLowerCase();
    return (!query || searchable.includes(query)) && (selectedStatus === 'all' || job.status === selectedStatus);
  });
  body.innerHTML = filtered.map((job) => `<tr>
    <td>JOB-${String(job.job_id).padStart(4, '0')}</td>
    <td>${escapeHtml(job.filename)}</td>
    <td>${escapeHtml(formatDate(job.created_at))}</td>
    <td>${job.pothole_count == null ? '—' : formatCount(job.pothole_count)}</td>
    <td><span class="status-badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td>
    <td>${job.detection_id ? `<button class="action-link" data-detection-id="${job.detection_id}">View</button>` : '—'}</td>
  </tr>`).join('');
  $('#emptyState').hidden = filtered.length > 0;
  $('#emptyState').textContent = recentJobs.length ? 'No jobs match this search or status.' : 'No processing jobs have been submitted.';
  $('#recordCount').textContent = recentJobs.length ? `Showing ${filtered.length} of ${recentJobs.length} recent jobs` : 'No jobs';
  $$('#activityTable [data-detection-id]').forEach((button) => button.addEventListener('click', () => loadDetection(button.dataset.detectionId)));
}

function renderActivityChart(summary) {
  const days = Number($('#activityRange').value);
  const series = summary.daily_activity.slice(-days);
  const max = Math.max(1, ...series.map((item) => item.count));
  const axis = $('#activityAxis');
  const chart = $('#activityChart');
  chart.classList.toggle('dense-bars', days > 7);
  const total = series.reduce((sum, item) => sum + item.count, 0);
  axis.innerHTML = `<span>${formatCount(max)}</span><span>${formatCount(Math.ceil(max / 2))}</span><span>0</span>`;
  $('#activityEmpty').hidden = total > 0;
  $('.chart-area').hidden = total === 0;
  chart.hidden = total === 0;
  chart.innerHTML = total ? series.map((item, index) => `<div class="bar-col" title="${escapeHtml(item.label)}: ${item.count}">
    <span class="bar-value">${formatCount(item.count)}</span><div class="bar ${index === series.length - 1 ? 'active' : ''}" style="height:${item.count ? Math.max(2, item.count / max * 100) : 0}%"></div><small>${escapeHtml(item.label)}</small>
  </div>`).join('') : '';
}

function renderMonthlyChart(summary) {
  const series = summary.monthly_activity;
  const total = series.reduce((sum, item) => sum + item.count, 0);
  $('#monthlyEmpty').hidden = total > 0;
  $('#monthlyChart').hidden = total === 0;
  const max = Math.max(1, ...series.map((item) => item.count));
  $('#monthlyChart').innerHTML = total ? series.map((item, index) => `<div class="bar-col" title="${escapeHtml(item.label)}: ${item.count}">
    <span class="bar-value">${formatCount(item.count)}</span><div class="bar ${index === series.length - 1 ? 'active' : ''}" style="height:${item.count ? Math.max(2, item.count / max * 100) : 0}%"></div><small>${escapeHtml(item.label)}</small>
  </div>`).join('') : '';
}

function renderJobStatuses(counts) {
  const entries = [
    ['completed', 'Completed', 'var(--teal)'],
    ['queued', 'Queued', 'var(--amber)'],
    ['processing', 'Processing', '#7da9a4'],
    ['failed', 'Failed', 'var(--rose)'],
  ].map(([key, label, color]) => ({ label, color, count: counts[key] || 0 }));
  const total = entries.reduce((sum, item) => sum + item.count, 0);
  $('#jobTotal').textContent = formatCount(total);
  $('#jobStatusEmpty').hidden = total > 0;
  $('.donut-wrap').hidden = total === 0;
  if (!total) return;
  let start = 0;
  const slices = entries.map((item) => {
    const end = start + item.count / total * 100;
    const slice = `${item.color} ${start}% ${end}%`;
    start = end;
    return slice;
  });
  $('#jobStatusDonut').style.background = `conic-gradient(${slices.join(',')})`;
  $('#jobStatusLegend').innerHTML = entries.map((item) => `<div><span class="legend-dot" style="background:${item.color}"></span><span>${item.label}</span><strong>${formatCount(item.count)}</strong></div>`).join('');
}

async function refreshDashboard() {
  $('#dashboardDate').textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date());
  try {
    const [summary, jobs] = await Promise.all([
      apiRequest('/dashboard/summary'), apiRequest('/dashboard/recent?limit=50'),
    ]);
    $('#dataConnectionLabel').textContent = 'Live workspace data';
    $('#footerStatus').textContent = 'Connected to workspace database';
    $('#metricImages').textContent = formatCount(summary.total_images);
    $('#metricPotholes').textContent = formatCount(summary.potholes_detected);
    $('#metricCompleted').textContent = formatCount(summary.completed_jobs);
    $('#metricActive').textContent = formatCount(summary.active_jobs);
    recentJobs = jobs;
    renderActivity();
    renderActivityChart(summary);
    renderMonthlyChart(summary);
    renderJobStatuses(summary.job_statuses);
  } catch (error) {
    $('#dataConnectionLabel').textContent = 'Workspace data unavailable';
    $('#footerStatus').textContent = 'Could not load workspace data';
    for (const selector of ['#metricImages', '#metricPotholes', '#metricCompleted', '#metricActive']) $(selector).textContent = '—';
    recentJobs = [];
    renderActivity();
    $('#emptyState').textContent = `Could not load processing jobs: ${error.message}`;
    $('#activityChart').hidden = true;
    $('#activityEmpty').hidden = false;
    $('#activityEmpty').textContent = 'Could not load detection activity.';
    $('#monthlyChart').hidden = true;
    $('#monthlyEmpty').hidden = false;
    $('#monthlyEmpty').textContent = 'Could not load monthly detections.';
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

$('#exportButton').addEventListener('click', () => {
  const header = ['Job ID', 'Image filename', 'Submitted', 'Potholes', 'Status'];
  const lines = recentJobs.map((job) => [
    `JOB-${String(job.job_id).padStart(4, '0')}`, job.filename, formatDate(job.created_at), job.pothole_count, job.status,
  ]);
  const csv = [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'yolo11-pothole-processing-jobs.csv';
  link.click();
  URL.revokeObjectURL(url);
});

async function loadDetection(detectionId, navigate = true) {
  const requestedId = Number(detectionId);
  selectedDetectionId = requestedId;
  currentDetectionId = requestedId;
  clearDetectionImageUrls();
  if (navigate) setPage('Detection Results', false);
  $('#resultEmpty').hidden = true;
  $('#resultContent').hidden = true;
  $('#downloadResult').hidden = true;
  $('#annotatedImage').hidden = true;
  $('#resultFilename').textContent = 'Loading stored detection result…';
  try {
    const detection = await apiRequest(`/detections/${requestedId}`);
    if (currentDetectionId !== requestedId) return;
    const sourceBlob = await apiBlob(detection.source_image_url);
    const annotatedBlob = detection.annotated_image_url ? await apiBlob(detection.annotated_image_url) : null;
    const sourceUrl = URL.createObjectURL(sourceBlob);
    const annotatedUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : null;
    if (currentDetectionId !== requestedId) {
      URL.revokeObjectURL(sourceUrl);
      if (annotatedUrl) URL.revokeObjectURL(annotatedUrl);
      return;
    }
    detectionImageObjectUrls = [sourceUrl, annotatedUrl].filter(Boolean);
    $('#resultFilename').textContent = detection.filename;
    $('#originalImage').src = sourceUrl;
    $('#annotatedImage').hidden = !annotatedUrl;
    if (annotatedUrl) $('#annotatedImage').src = annotatedUrl;
    $('#resultCount').textContent = formatCount(detection.pothole_count);
    const confidence = detection.items.length ? Math.max(...detection.items.map((item) => item.confidence)) : null;
    $('#resultConfidence').textContent = confidence == null ? 'No detections' : `${(confidence * 100).toFixed(1)}%`;
    $('#resultSeverity').textContent = detection.severity || 'Not calculated';
    $('#resultTime').textContent = detection.inference_ms == null ? '—' : `${(detection.inference_ms / 1000).toFixed(2)} sec`;
    $('#resultModel').textContent = detection.model_name || '—';
    $('#resultStatus').textContent = detection.status;
    $('#downloadResult').href = annotatedUrl || '#';
    $('#downloadResult').download = `pothole-detection-${detection.id}.jpg`;
    $('#downloadResult').hidden = !detection.annotated_image_url;
    $('#resultContent').hidden = false;
  } catch (error) {
    if (currentDetectionId !== requestedId) return;
    $('#resultFilename').textContent = error.message;
    $('#resultEmpty').hidden = false;
  }
}

function clearDetectionImageUrls() {
  detectionImageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  detectionImageObjectUrls = [];
  $('#originalImage').removeAttribute('src');
  $('#annotatedImage').removeAttribute('src');
}

const moduleTitles = {
  'Detection History': 'Detection history', 'Image Management': 'Image management',
  'Pothole Locations': 'Pothole locations', Analytics: 'Analytics', Reports: 'Reports',
  'User Management': 'User management', 'Processing Jobs': 'Processing jobs',
  'YOLO11 Model Information': 'YOLO11 model information', 'System Monitoring': 'System monitoring',
  Notifications: 'Notifications', 'Audit Logs': 'Audit logs', Profile: 'Workspace profile', Settings: 'Settings',
};

function moduleShell(page, description, content) {
  const title = moduleTitles[page] || page;
  $('#modulePage').innerHTML = `<div class="module-hero"><div><p class="eyebrow">Workspace / ${escapeHtml(title)}</p><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(description)}</p></div></div>${content}`;
}

function moduleEmpty(title, detail = 'No records are stored for this section.') {
  return `<article class="panel module-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></article>`;
}

function renderJobsModule(jobs) {
  if (!jobs.length) return moduleEmpty('No processing jobs', 'Uploaded images and their jobs will appear here.');
  const rows = jobs.map((job) => `<tr><td>JOB-${String(job.job_id).padStart(4, '0')}</td><td>${escapeHtml(job.filename)}</td><td>${escapeHtml(formatDate(job.created_at))}</td><td>${job.pothole_count == null ? '—' : formatCount(job.pothole_count)}</td><td><span class="status-badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td><td>${job.detection_id ? `<button class="action-link" data-detection-id="${job.detection_id}">View</button>` : '—'}</td></tr>`).join('');
  return `<article class="panel"><div class="table-wrap"><table class="module-table"><thead><tr><th>Job ID</th><th>Image</th><th>Submitted</th><th>Potholes</th><th>Status</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderAdminTable(title, columns, rows, emptyTitle, emptyDetail) {
  if (!rows.length) return moduleEmpty(emptyTitle, emptyDetail);
  const head = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map(([, render]) => `<td>${render(row)}</td>`).join('')}</tr>`).join('');
  return `<article class="panel"><div class="table-wrap"><table class="module-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}

function openStreetMapEmbedUrl(latitude, longitude) {
  const mapLatitude = Math.max(-85.0511, Math.min(85.0511, latitude));
  const padding = 0.01;
  const south = Math.max(-85.0511, mapLatitude - padding);
  const north = Math.min(85.0511, mapLatitude + padding);
  const west = Math.max(-180, longitude - padding);
  const east = Math.min(180, longitude + padding);
  const url = new URL('https://www.openstreetmap.org/export/embed.html');
  url.searchParams.set('bbox', `${west},${south},${east},${north}`);
  url.searchParams.set('layer', 'mapnik');
  url.searchParams.set('marker', `${mapLatitude},${longitude}`);
  return url.href;
}

function renderLocationsModule(locations) {
  if (!locations.length) {
    return moduleEmpty('No locations captured yet', 'During image upload, attach your device location if it matches where the selected photos were taken.');
  }
  const firstLocation = locations[0];
  const cards = locations.map((location, index) => {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const mapUrl = new URL('https://www.openstreetmap.org/');
    mapUrl.searchParams.set('mlat', latitude);
    mapUrl.searchParams.set('mlon', longitude);
    mapUrl.hash = `map=17/${latitude}/${longitude}`;
    const accuracy = location.accuracy_m == null ? 'Accuracy unavailable' : `Accuracy ±${Number(location.accuracy_m).toFixed(0)} m`;
    return `<article class="location-card${index === 0 ? ' selected' : ''}"><div class="location-card-heading"><div><strong>${escapeHtml(location.image_filename)}</strong><small>Image #${formatCount(location.image_id)} · ${escapeHtml(formatDate(location.captured_at))}</small></div><span class="location-source">Browser GPS</span></div><p class="location-coordinates">${latitude.toFixed(6)}, ${longitude.toFixed(6)}</p><div class="location-card-footer"><small>${accuracy} · ${escapeHtml(location.source.replaceAll('_', ' '))}</small><div class="location-card-actions"><button class="action-link" type="button" data-location-index="${index}">Show on map</button><a class="action-link" href="${escapeHtml(mapUrl.href)}" target="_blank" rel="noopener noreferrer">Open in OpenStreetMap ↗</a></div></div></article>`;
  }).join('');
  return `<article class="panel location-list-panel"><div class="panel-header"><div><h3>${formatCount(locations.length)} saved location${locations.length === 1 ? '' : 's'}</h3><p>Coordinates captured from the browser at image upload time.</p></div></div><div class="location-map-wrap"><p class="location-map-notice">Choose <strong>Show on map</strong> for a location to load its map from OpenStreetMap. The selected coordinates are shared with that map service.</p><div class="location-map-placeholder" id="locationMapPlaceholder">Select a saved location below to see it on the map.</div><iframe class="location-map" id="locationMap" title="Map for ${escapeHtml(firstLocation.image_filename)}" loading="lazy" referrerpolicy="no-referrer" hidden></iframe><div class="map-attribution">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></div><p class="location-map-caption" id="locationMapCaption" hidden></p></div><div class="location-list">${cards}</div><p class="location-privacy-note">Coordinates are approximate and may differ from the photo’s original capture location.</p></article>`;
}

async function renderModule(page) {
  const requestId = ++moduleRequestId;
  let pageLocations = [];
  const descriptions = {
    'Detection History': 'Processing jobs and completed model results stored in the workspace.',
    'Processing Jobs': 'Current and completed image processing jobs.',
    'Image Management': 'Images uploaded to this workspace.',
    'YOLO11 Model Information': 'Configured model readiness from the inference service.',
    'System Monitoring': 'Live API, database, and model health.',
    'Pothole Locations': 'Location records linked to uploaded road images.',
    Analytics: 'Aggregated counts from stored inference results.',
    Reports: 'Reports generated from stored workspace data.',
    'User Management': 'User records configured for this workspace.',
    Notifications: 'Notifications stored for this workspace.',
    'Audit Logs': 'Recorded workspace actions.',
    Profile: 'Workspace identity and account information.',
    Settings: 'Saved application settings.',
  };
  moduleShell(page, descriptions[page] || '', '<article class="panel module-empty"><strong>Loading workspace data</strong></article>');
  try {
    let content = '';
    if (['Detection History', 'Processing Jobs'].includes(page)) {
      const jobs = await apiRequest('/dashboard/recent?limit=100');
      content = renderJobsModule(jobs);
    } else if (page === 'Image Management') {
      const images = await apiRequest('/dashboard/images?limit=100');
      content = images.length ? `<article class="panel"><div class="table-wrap"><table class="module-table"><thead><tr><th>Image</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Source</th><th>Action</th></tr></thead><tbody>${images.map((image) => `<tr><td>${escapeHtml(image.filename)}</td><td>${escapeHtml(image.content_type || '—')}</td><td>${image.file_size == null ? '—' : `${(image.file_size / 1024).toFixed(1)} KB`}</td><td>${escapeHtml(formatDate(image.created_at))}</td><td>${escapeHtml(image.source)}</td><td>${image.can_delete ? `<button class="delete-image-button" type="button" data-delete-image="${image.id}" data-filename="${escapeHtml(image.filename)}">Delete</button>` : '<span class="readonly-label">Read-only</span>'}</td></tr>`).join('')}</tbody></table></div></article>` : moduleEmpty('No images uploaded', 'Images you submit for processing will appear here.');
    } else if (page === 'Pothole Locations') {
      const locations = await apiRequest('/locations?limit=100');
      pageLocations = locations;
      content = renderLocationsModule(locations);
    } else if (page === 'YOLO11 Model Information') {
      const model = await apiRequest('/health/model');
      content = `<article class="panel module-empty"><strong>Model status: ${escapeHtml(model.status)}</strong><span>${escapeHtml(model.path || 'No model path configured')}</span>${model.detail ? `<span>${escapeHtml(model.detail)}</span>` : ''}</article>`;
    } else if (page === 'System Monitoring') {
      const health = await refreshServiceStatus();
      content = health ? `<article class="panel module-card-list"><div class="module-card-row"><strong>API</strong><span>${escapeHtml(health.api.status)}</span></div><div class="module-card-row"><strong>Database</strong><span>${escapeHtml(health.database.database)}</span></div><div class="module-card-row"><strong>YOLO11 model</strong><span>${escapeHtml(health.model.status)}</span></div></article>` : moduleEmpty('Backend unavailable', 'Health information could not be loaded.');
    } else if (page === 'Analytics') {
      const summary = await apiRequest('/dashboard/summary');
      content = `<article class="panel module-kpis"><div class="module-kpi"><small>Images</small><strong>${formatCount(summary.total_images)}</strong></div><div class="module-kpi"><small>Potholes detected</small><strong>${formatCount(summary.potholes_detected)}</strong></div><div class="module-kpi"><small>Completed jobs</small><strong>${formatCount(summary.completed_jobs)}</strong></div></article>`;
    } else if (page === 'User Management') {
      const users = await apiRequest('/administration/users?limit=100');
      const clientCount = users.filter((user) => user.role === 'client').length;
      const adminCount = users.filter((user) => user.role === 'admin').length;
      content = `<article class="panel module-kpis user-role-summary"><div class="module-kpi"><small>Clients</small><strong>${formatCount(clientCount)}</strong></div><div class="module-kpi"><small>Administrators</small><strong>${formatCount(adminCount)}</strong></div></article>` + renderAdminTable('Users', [
        ['Name', (user) => `<strong>${escapeHtml(user.display_name)}</strong>`],
        ['Email', (user) => escapeHtml(user.email)],
        ['Status', (user) => escapeHtml(user.is_active ? 'Active' : 'Inactive')],
        ['Created', (user) => escapeHtml(formatDate(user.created_at))],
        ['Role', (user) => `<select class="user-role-select" data-user-role="${user.id}" data-current-role="${escapeHtml(user.role)}" aria-label="Role for ${escapeHtml(user.display_name)}"${user.role === 'admin' && user.id === Number(window.currentUserId) ? ' disabled' : ''}><option value="admin"${user.role === 'admin' ? ' selected' : ''}>Admin</option><option value="client"${user.role === 'client' ? ' selected' : ''}>Client</option></select>`],
        ['Action', (user) => `<div class="user-actions"><button class="user-status-button" type="button" data-user-status="${user.id}" data-next-status="${user.is_active ? 'false' : 'true'}" data-display-name="${escapeHtml(user.display_name)}">${user.is_active ? 'Deactivate' : 'Approve'}</button><button class="delete-user-button" type="button" data-delete-user="${user.id}" data-display-name="${escapeHtml(user.display_name)}">Remove</button></div>`],
      ], users, 'No user accounts', 'Registered workspace accounts will appear here.');
    } else if (page === 'Notifications') {
      const notifications = await apiRequest('/administration/notifications?limit=100');
      content = renderAdminTable('Notifications', [
        ['Notification', (item) => `<strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.message)}</small>`],
        ['Type', (item) => escapeHtml(item.kind)], ['Status', (item) => escapeHtml(item.is_read ? 'Read' : 'Unread')],
        ['Created', (item) => escapeHtml(formatDate(item.created_at))],
      ], notifications, 'No notifications', 'System notifications will be stored here when generated.');
    } else if (page === 'Audit Logs') {
      const logs = await apiRequest('/administration/audit-logs?limit=100');
      content = renderAdminTable('Audit logs', [
        ['Action', (item) => `<strong>${escapeHtml(item.action)}</strong>`],
        ['Entity', (item) => escapeHtml(item.entity_type ? `${item.entity_type}${item.entity_id ? ` #${item.entity_id}` : ''}` : '—')],
        ['Details', (item) => escapeHtml(item.details ? JSON.stringify(item.details) : '—')],
        ['When', (item) => escapeHtml(formatDate(item.created_at))],
      ], logs, 'No audit events', 'Changes made in this workspace will be recorded here.');
    } else if (page === 'Profile') {
      const user = await apiRequest('/auth/me');
      content = `<article class="panel module-card-list"><div class="module-card-row"><strong>Display name</strong><span>${escapeHtml(user.display_name)}</span></div><div class="module-card-row"><strong>Email</strong><span>${escapeHtml(user.email)}</span></div><div class="module-card-row"><strong>Role</strong><span>${escapeHtml(user.role)}</span></div><div class="module-card-row"><strong>Account status</strong><span>${escapeHtml(user.is_active ? 'Active' : 'Inactive')}</span></div></article>`;
    } else if (page === 'Reports') {
      const summary = await apiRequest('/dashboard/summary');
      content = `<article class="panel module-kpis"><div class="module-kpi"><small>Total images</small><strong>${formatCount(summary.total_images)}</strong></div><div class="module-kpi"><small>Potholes detected</small><strong>${formatCount(summary.potholes_detected)}</strong></div><div class="module-kpi"><small>Completed jobs</small><strong>${formatCount(summary.completed_jobs)}</strong></div><div class="module-kpi"><small>Failed jobs</small><strong>${formatCount(summary.failed_jobs)}</strong></div><p class="muted">This report is calculated from the records currently stored in the workspace database.</p></article>`;
    } else if (page === 'Settings') {
      const detectionSettings = await apiRequest('/settings/detection-confidence');
      content = `<article class="panel detection-settings"><div class="panel-header"><div><h3>Detection sensitivity</h3><p>Choose how confident the model must be before it marks a pothole.</p></div><span class="settings-value" id="confidenceValue">${Math.round(detectionSettings.confidence * 100)}%</span></div><label class="settings-slider-label" for="detectionConfidence"><span>More detections</span><span>Fewer false alarms</span></label><input id="detectionConfidence" type="range" min="0.3" max="0.95" step="0.05" value="${detectionSettings.confidence}" aria-describedby="confidenceHelp"><div class="settings-guidance"><strong id="confidenceMode">${detectionSettings.confidence >= 0.75 ? 'Fewer false alarms' : detectionSettings.confidence <= 0.55 ? 'More detections' : 'Balanced'}</strong><span id="confidenceHelp">Higher settings suppress uncertain boxes but can miss real potholes. Applies to new uploads only.</span></div><button class="primary-button" id="saveDetectionConfidence" type="button">Save detection setting</button><p class="settings-save-status" id="confidenceSaveStatus" role="status" aria-live="polite"></p></article>`;
    } else {
      const emptyCopy = {
        'Pothole Locations': 'No location records are stored yet.',
        Reports: 'No reports have been generated yet.',
        'User Management': 'No user accounts are configured.',
        Notifications: 'No notifications are stored.',
        'Audit Logs': 'No audit events are stored.',
        Profile: 'No signed-in user profile is configured.',
        Settings: 'No application settings have been saved.',
      };
      content = moduleEmpty(emptyCopy[page] || 'No records available.');
    }
    if (requestId === moduleRequestId) moduleShell(page, descriptions[page] || '', content);
    $$('#modulePage [data-detection-id]').forEach((button) => button.addEventListener('click', () => loadDetection(button.dataset.detectionId)));
    $$('#modulePage [data-delete-image]').forEach((button) => button.addEventListener('click', async () => {
      const filename = button.dataset.filename;
      if (!window.confirm(`Delete “${filename}” and its detection results, jobs, and location? This cannot be undone.`)) return;
      button.disabled = true;
      button.textContent = 'Deleting…';
      try {
        await apiRequest(`/images/${button.dataset.deleteImage}`, { method: 'DELETE' });
        toast(`Deleted ${filename}`);
        await refreshDashboard();
        if ($('.nav-item.active')?.dataset.page === 'Image Management') await renderModule('Image Management');
      } catch (error) {
        toast(`Could not delete image · ${error.message}`);
        button.disabled = false;
        button.textContent = 'Delete';
      }
    }));
    $$('#modulePage [data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
      const displayName = button.dataset.displayName;
      if (!window.confirm(`Remove user “${displayName}”? Their images, jobs, and audit history will be kept.`)) return;
      button.disabled = true;
      button.textContent = 'Removing…';
      try {
        await apiRequest(`/administration/users/${button.dataset.deleteUser}`, { method: 'DELETE' });
        toast(`Removed ${displayName}`);
        await renderModule('User Management');
      } catch (error) {
        toast(`Could not remove user · ${error.message}`);
        button.disabled = false;
        button.textContent = 'Remove';
      }
    }));
    $$('#modulePage [data-user-role]').forEach((select) => select.addEventListener('change', async () => {
      const previousRole = select.dataset.currentRole;
      const nextRole = select.value;
      select.disabled = true;
      try {
        const updated = await apiRequest(`/administration/users/${select.dataset.userRole}/role`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: nextRole }),
        });
        select.dataset.currentRole = updated.role;
        toast(`Updated ${updated.display_name} to ${updated.role}`);
      } catch (error) {
        select.value = previousRole;
        toast(`Could not update role · ${error.message}`);
      } finally {
        select.disabled = false;
      }
    }));
    $$('#modulePage [data-user-status]').forEach((button) => button.addEventListener('click', async () => {
      const nextStatus = button.dataset.nextStatus === 'true';
      const displayName = button.dataset.displayName;
      const action = nextStatus ? 'approve' : 'deactivate';
      if (!window.confirm(`${nextStatus ? 'Approve' : 'Deactivate'} profile “${displayName}”?`)) return;
      button.disabled = true;
      try {
        await apiRequest(`/administration/users/${button.dataset.userStatus}/status`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: nextStatus }),
        });
        toast(`${nextStatus ? 'Approved' : 'Deactivated'} ${displayName}`);
        await renderModule('User Management');
      } catch (error) {
        toast(`Could not ${action} profile · ${error.message}`);
        button.disabled = false;
      }
    }));
    if (page === 'Settings') {
      const slider = $('#detectionConfidence');
      const label = $('#confidenceValue');
      const mode = $('#confidenceMode');
      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        label.textContent = `${Math.round(value * 100)}%`;
        mode.textContent = value >= 0.75 ? 'Fewer false alarms' : value <= 0.55 ? 'More detections' : 'Balanced';
      });
      $('#saveDetectionConfidence').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Saving…';
        $('#confidenceSaveStatus').textContent = '';
        try {
          const saved = await apiRequest('/settings/detection-confidence', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confidence: Number(slider.value) }),
          });
          slider.value = saved.confidence;
          label.textContent = `${Math.round(saved.confidence * 100)}%`;
          $('#confidenceSaveStatus').textContent = 'Saved. This setting will be used for new uploads.';
          toast('Detection setting saved');
        } catch (error) {
          $('#confidenceSaveStatus').textContent = `Could not save setting · ${error.message}`;
        } finally {
          button.disabled = false;
          button.textContent = 'Save detection setting';
        }
      });
    }
    if (page === 'Pothole Locations') {
      $$('#modulePage [data-location-index]').forEach((button) => button.addEventListener('click', () => {
        const location = pageLocations[Number(button.dataset.locationIndex)];
        if (!location) return;
        const frame = $('#locationMap');
        frame.src = openStreetMapEmbedUrl(Number(location.latitude), Number(location.longitude));
        frame.title = `Map for ${location.image_filename}`;
        frame.hidden = false;
        $('#locationMapPlaceholder').hidden = true;
        $('#locationMapCaption').hidden = false;
        $('#locationMapCaption').textContent = `Showing ${location.image_filename}`;
        $$('#modulePage .location-card').forEach((card) => card.classList.remove('selected'));
        button.closest('.location-card').classList.add('selected');
      }));
    }
  } catch (error) {
    if (requestId === moduleRequestId) moduleShell(page, descriptions[page] || '', moduleEmpty('Could not load workspace data', error.message));
  }
}

const overviewElements = ['#welcomeRow', '#metricGrid', '#chartGrid', '#systemGrid', '#activityPanel'];
const modulePages = Object.keys(moduleTitles);

function setPage(page, autoLoadDetection = true) {
  const overview = page === 'Overview';
  const upload = page === 'Image Upload';
  const camera = page === 'Live Camera Capture';
  const results = page === 'Detection Results';
  if (!results) {
    currentDetectionId = null;
    clearDetectionImageUrls();
  }
  $('#uploadPage').hidden = !upload;
  $('#cameraPage').hidden = !camera;
  $('#resultsPage').hidden = !results;
  $('#modulePage').hidden = !modulePages.includes(page);
  overviewElements.forEach((selector) => { $(selector).hidden = !overview; });
  $('#breadcrumbCurrent').textContent = page;
  $('#pageTitle').textContent = page === 'Overview' ? 'YOLO11 Pothole Detection' : page;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $('#sidebar').classList.remove('open');
  if (modulePages.includes(page)) renderModule(page);
  if (results && autoLoadDetection && selectedDetectionId) {
    loadDetection(selectedDetectionId, false);
  } else if (results && !selectedDetectionId) {
    $('#resultContent').hidden = true;
    $('#resultEmpty').hidden = false;
    $('#resultFilename').textContent = 'Select a completed processing job to view its result.';
    $('#downloadResult').hidden = true;
  }
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
$('#globalSearch').addEventListener('input', renderActivity);
$('#statusFilter').addEventListener('change', renderActivity);
$('#activityRange').addEventListener('change', () => refreshDashboard().catch(() => {}));
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#refreshStatus').addEventListener('click', refreshServiceStatus);
$('#viewHistory').addEventListener('click', () => setPage('Detection History'));
$('#exportButton').addEventListener('click', () => {
  const header = ['Job ID', 'Image filename', 'Submitted', 'Potholes', 'Status'];
  const rows = recentJobs.map((job) => [`JOB-${String(job.job_id).padStart(4, '0')}`, job.filename, formatDate(job.created_at), job.pothole_count, job.status]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'yolo11-pothole-processing-jobs.csv';
  link.click();
  URL.revokeObjectURL(url);
});

const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
function renderUploadFiles() {
  const grid = $('#previewGrid');
  $('#uploadSummary').textContent = selectedFiles.length ? `${selectedFiles.length} image${selectedFiles.length === 1 ? '' : 's'} selected` : 'No images selected';
  $('#selectedFilesHelp').textContent = selectedFiles.length ? 'Review these previews before submitting them for inference.' : 'Choose images to preview them here.';
  $('#startUpload').disabled = selectedFiles.length === 0;
  $('#clearFiles').hidden = selectedFiles.length === 0;
  grid.innerHTML = selectedFiles.length ? selectedFiles.map((file, index) => `<div class="preview-card"><button class="remove-preview" data-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button><img src="${URL.createObjectURL(file)}" alt="${escapeHtml(file.name)}"><div class="preview-meta"><strong>${escapeHtml(file.name)}</strong><small>${(file.size / 1024 / 1024).toFixed(2)} MB</small></div></div>`).join('') : '<div class="empty-state">No images selected.</div>';
  $$('.remove-preview').forEach((button) => button.addEventListener('click', () => {
    selectedFiles.splice(Number(button.dataset.index), 1);
    renderUploadFiles();
  }));
}

function acceptFiles(files) {
  selectedFiles = [...selectedFiles, ...files].filter((file, index, list) => list.findIndex((item) => item.name === file.name && item.size === file.size) === index).slice(0, 8);
  renderUploadFiles();
}

function renderLocationCapture() {
  const clearButton = $('#clearLocation');
  clearButton.hidden = !selectedLocation;
  $('#locationStatus').textContent = selectedLocation
    ? `${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(6)} · ${selectedLocation.accuracy == null ? 'accuracy unavailable' : `±${selectedLocation.accuracy.toFixed(0)} m accuracy`} · captured ${formatDate(selectedLocation.capturedAt)}`
    : 'No location attached.';
}

$('#captureLocation').addEventListener('click', () => {
  const button = $('#captureLocation');
  if (!navigator.geolocation) {
    $('#locationStatus').textContent = 'Location is unavailable in this browser. Use localhost or a secure HTTPS connection.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Requesting location…';
  $('#locationStatus').textContent = 'Waiting for browser location permission and a GPS fix…';
  navigator.geolocation.getCurrentPosition((position) => {
    selectedLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude,
      accuracy: position.coords.accuracy,
      capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
    };
    button.disabled = false;
    button.textContent = '⌖ Refresh location';
    renderLocationCapture();
  }, (error) => {
    const messages = {
      1: 'Location permission was denied. You can allow it in browser settings and try again.',
      2: 'The device could not determine a location. Try again where GPS or network location is available.',
      3: 'Location request timed out. Try again.',
    };
    $('#locationStatus').textContent = messages[error.code] || 'Could not capture the device location.';
    button.disabled = false;
    button.textContent = selectedLocation ? '⌖ Refresh location' : '⌖ Capture location';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

$('#clearLocation').addEventListener('click', () => {
  selectedLocation = null;
  $('#captureLocation').textContent = '⌖ Capture location';
  renderLocationCapture();
});

$('#chooseFiles').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => acceptFiles([...fileInput.files]));
['dragenter', 'dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', (event) => acceptFiles([...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'))));
$('#clearFiles').addEventListener('click', () => { selectedFiles = []; fileInput.value = ''; renderUploadFiles(); });

function setAuthMode(mode) {
  const registering = mode === 'register';
  $('#signInForm').hidden = registering;
  $('#registerForm').hidden = !registering;
  $('#showSignIn').classList.toggle('active', !registering);
  $('#showRegister').classList.toggle('active', registering);
  $('#showSignIn').setAttribute('aria-selected', String(!registering));
  $('#showRegister').setAttribute('aria-selected', String(registering));
  $('#authTitle').textContent = registering ? 'Create your account' : 'Sign in';
  $('#authDescription').textContent = registering
    ? 'Create an account to access the pothole detection workspace.'
    : 'Sign in to access your pothole detection workspace.';
  $('#authMessage').textContent = '';
}

function showAuthScreen(message = '') {
  currentDetectionId = null;
  selectedDetectionId = null;
  clearDetectionImageUrls();
  $('#appShell').hidden = true;
  $('#authScreen').hidden = false;
  if (message) $('#authMessage').textContent = message;
}

function enterWorkspace(user) {
  $('#authScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#userDisplayName').textContent = user.display_name;
  $('#userEmail').textContent = user.email;
  $('#userAvatar').textContent = user.display_name.trim().charAt(0).toUpperCase() || 'U';
  window.currentUserId = user.id;
  $$('[data-admin-only]').forEach((element) => { element.hidden = user.role !== 'admin'; });
  refreshDashboard();
  refreshServiceStatus();
}

$('#showSignIn').addEventListener('click', () => setAuthMode('sign-in'));
$('#showRegister').addEventListener('click', () => setAuthMode('register'));

$('#signInForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  const credentials = new FormData();
  credentials.set('username', values.get('email'));
  credentials.set('password', values.get('password'));
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  $('#authMessage').textContent = '';
  try {
    const session = await apiRequest('/auth/token', { method: 'POST', body: credentials });
    setAccessToken(session.access_token);
    enterWorkspace(await apiRequest('/auth/me'));
  } catch (error) {
    setAccessToken(null);
    $('#authMessage').textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  submit.textContent = 'Creating account…';
  $('#authMessage').textContent = '';
  try {
    const session = await apiRequest('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    setAccessToken(session.access_token);
    enterWorkspace(await apiRequest('/auth/me'));
  } catch (error) {
    setAccessToken(null);
    $('#authMessage').textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Create account';
  }
});

$('#signOut').addEventListener('click', () => {
  setAccessToken(null);
  setAuthMode('sign-in');
  showAuthScreen('You have signed out.');
});

window.addEventListener('auth:expired', () => {
  setAuthMode('sign-in');
  showAuthScreen('Your session expired. Sign in again to continue.');
});

async function bootstrapAuthentication() {
  const token = getAccessToken();
  if (!token) {
    setAuthMode('sign-in');
    showAuthScreen();
    return;
  }
  try {
    enterWorkspace(await apiRequest('/auth/me'));
  } catch {
    setAccessToken(null);
    setAuthMode('sign-in');
    showAuthScreen('Your session expired. Sign in again to continue.');
  }
}

$('#startUpload').addEventListener('click', async () => {
  if (!selectedFiles.length) return;
  const button = $('#startUpload');
  button.disabled = true;
  button.textContent = 'Uploading…';
  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append('files', file));
  if (selectedLocation) {
    formData.append('latitude', String(selectedLocation.latitude));
    formData.append('longitude', String(selectedLocation.longitude));
    if (selectedLocation.altitude != null) formData.append('altitude_m', String(selectedLocation.altitude));
    if (selectedLocation.accuracy != null) formData.append('accuracy_m', String(selectedLocation.accuracy));
    formData.append('captured_at', selectedLocation.capturedAt);
  }
  try {
    const jobs = await apiRequest('/images/process', { method: 'POST', body: formData });
    const states = await Promise.all(jobs.map(async (job) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const state = await apiRequest(`/jobs/${job.job_id}`);
        if (['completed', 'failed'].includes(state.status)) return state;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { status: 'processing' };
    }));
    const completed = states.filter((job) => job.status === 'completed').length;
    const failed = states.filter((job) => job.status === 'failed').length;
    const active = states.filter((job) => ['queued', 'processing'].includes(job.status)).length;
    toast(`${completed} completed · ${failed} failed · ${active} still processing`);
    await refreshDashboard();
  } catch (error) {
    toast(`Upload failed · ${error.message}`);
  } finally {
    button.textContent = 'Upload and process';
    button.disabled = selectedFiles.length === 0;
  }
});

bootstrapAuthentication();
