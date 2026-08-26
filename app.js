let rawData = [];
let charts = {};
let map;
let markerLayer;

const $ = (id) => document.getElementById(id);
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n) => Math.round(n || 0).toLocaleString('ko-KR');
const clean = (v) => String(v ?? '').trim();

function parseTimeToMinutes(value) {
  const s = clean(value);
  if (!s || !s.includes(':')) return null;
  const [h, m] = s.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function hoursBetween(start, end) {
  const s = parseTimeToMinutes(start);
  const e = parseTimeToMinutes(end);
  if (s === null || e === null || e < s) return 0;
  return (e - s) / 60;
}

function getRegion(row) {
  const addr = clean(row['소재지도로명주소'] || row['소재지지번주소']);
  return addr.split(/\s+/)[0] || '지역미상';
}

function isWeekendOpen(row) {
  return clean(row['주말운영시작시각']) !== '' && clean(row['주말운영종료시각']) !== '';
}

function groupCount(data, keyFn) {
  const m = new Map();
  data.forEach((row) => {
    const key = keyFn(row) || '미분류';
    m.set(key, (m.get(key) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function groupAverage(data, keyFn, valueFn, predicate = () => true) {
  const m = new Map();
  data.filter(predicate).forEach((row) => {
    const key = keyFn(row) || '미분류';
    const val = valueFn(row);
    if (!Number.isFinite(val)) return;
    if (!m.has(key)) m.set(key, { sum: 0, count: 0 });
    const x = m.get(key);
    x.sum += val;
    x.count += 1;
  });
  return [...m.entries()].map(([k, v]) => [k, v.count ? v.sum / v.count : 0]).sort((a, b) => b[1] - a[1]);
}

function createChart(id, type, labels, data, label) {
  const canvas = $(id);
  if (!canvas || typeof Chart === 'undefined') return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas.getContext('2d'), {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: ['#2457d6','#5c7cfa','#7c9bff','#9ab1ff','#b5c5ff','#6c8cff','#4d6fe8','#8ba3ef','#adc0f5','#d4ddfa'],
        borderWidth: 0,
        borderRadius: type === 'bar' ? 8 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: type === 'doughnut' } },
      scales: type === 'doughnut' ? {} : {
        y: { beginAtZero: true, grid: { color: '#eef2f7' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// 외부 라이브러리 없이 동작하는 CSV 파서
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => clean(h));
  return rows.slice(1)
    .filter(r => r.some(v => clean(v) !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const broken = (text.match(/�/g) || []).length;
  if (broken > 3) {
    try { text = new TextDecoder('euc-kr', { fatal: false }).decode(buffer); } catch (_) {}
  }
  return text;
}

async function loadCSVFile(file) {
  if (!file) return;
  const status = $('fileName');
  status.textContent = `${file.name} 불러오는 중...`;
  status.classList.remove('error');
  try {
    const text = await readFileText(file);
    const parsed = parseCSV(text);
    if (!parsed.length) throw new Error('데이터 행을 찾지 못했습니다. CSV 형식을 확인해주세요.');
    rawData = parsed;
    status.textContent = `✓ ${file.name} · ${fmt(rawData.length)}개 시설 불러옴`;
    status.classList.add('success');
    renderDashboard();
    document.querySelector('.intro-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    status.textContent = `파일 읽기 실패: ${err.message}`;
    status.classList.add('error');
    alert('CSV 파일을 읽지 못했습니다.\n\n' + err.message);
  }
}

function renderDashboard() {
  const total = rawData.length;
  const free = rawData.filter(r => clean(r['유료사용여부']).toUpperCase() === 'N').length;
  const paidRows = rawData.filter(r => clean(r['유료사용여부']).toUpperCase() === 'Y');
  const paid = paidRows.length;
  const avgFee = paidRows.length ? paidRows.reduce((s, r) => s + num(r['사용료']), 0) / paidRows.length : 0;
  const capRows = rawData.filter(r => num(r['수용가능인원수']) > 0);
  const avgCap = capRows.length ? capRows.reduce((s, r) => s + num(r['수용가능인원수']), 0) / capRows.length : 0;
  const weekend = rawData.filter(isWeekendOpen).length;

  $('kpiTotal').textContent = fmt(total);
  $('kpiFree').textContent = fmt(free);
  $('kpiPaid').textContent = fmt(paid);
  $('kpiFee').textContent = fmt(avgFee);
  $('kpiCapacity').textContent = fmt(avgCap);
  $('kpiWeekend').textContent = fmt(weekend);

  const typeCounts = groupCount(rawData, r => clean(r['개방시설유형구분']) || '미분류');
  const topType = typeCounts[0] || ['미분류', 0];
  const regionCounts = groupCount(rawData, getRegion);
  const topRegion = regionCounts[0] || ['지역미상', 0];
  const maxCapRow = rawData.reduce((best, r) => num(r['수용가능인원수']) > num(best?.['수용가능인원수']) ? r : best, null);
  const freeRate = total ? free / total * 100 : 0;
  const weekendRate = total ? weekend / total * 100 : 0;

  $('overallInsight').innerHTML = `
    전체 <strong>${fmt(total)}개</strong> 시설 중 무료 시설은 <strong>${fmt(free)}개(${freeRate.toFixed(1)}%)</strong>, 유료 시설은 <strong>${fmt(paid)}개</strong>입니다.
    가장 많은 시설유형은 <strong>${topType[0]} ${fmt(topType[1])}개</strong>이며, 지역별로는 <strong>${topRegion[0]}</strong>의 시설 수가 가장 많습니다.
    유료시설의 평균 사용료는 <strong>${fmt(avgFee)}원</strong>, 전체 시설의 평균 수용인원은 <strong>${fmt(avgCap)}명</strong>입니다.
    주말 개방 시설은 <strong>${fmt(weekend)}개(${weekendRate.toFixed(1)}%)</strong>입니다.
    ${maxCapRow ? `가장 많은 인원을 수용할 수 있는 시설은 <strong>${clean(maxCapRow['개방시설명']) || '시설명 미상'}(${fmt(num(maxCapRow['수용가능인원수']))}명)</strong>입니다.` : ''}
  `;

  createChart('typeChart', 'bar', typeCounts.slice(0,10).map(x=>x[0]), typeCounts.slice(0,10).map(x=>x[1]), '시설 수');
  createChart('feeChart', 'doughnut', ['무료','유료'], [free,paid], '시설 수');
  const avgFees = groupAverage(rawData, r=>clean(r['개방시설유형구분'])||'미분류', r=>num(r['사용료']), r=>clean(r['유료사용여부']).toUpperCase()==='Y' && num(r['사용료'])>0);
  createChart('avgFeeChart', 'bar', avgFees.slice(0,10).map(x=>x[0]), avgFees.slice(0,10).map(x=>Math.round(x[1])), '평균 사용료');
  const avgCaps = groupAverage(rawData, r=>clean(r['개방시설유형구분'])||'미분류', r=>num(r['수용가능인원수']), r=>num(r['수용가능인원수'])>0);
  createChart('capacityChart', 'bar', avgCaps.slice(0,10).map(x=>x[0]), avgCaps.slice(0,10).map(x=>Math.round(x[1])), '평균 수용인원');
  const weekdayHours = rawData.map(r=>hoursBetween(r['평일운영시작시각'], r['평일운영종료시각'])).filter(v=>v>0);
  const weekendHours = rawData.map(r=>hoursBetween(r['주말운영시작시각'], r['주말운영종료시각'])).filter(v=>v>0);
  const avgWeekdayHours = weekdayHours.length ? weekdayHours.reduce((a,b)=>a+b,0)/weekdayHours.length : 0;
  const avgWeekendHours = weekendHours.length ? weekendHours.reduce((a,b)=>a+b,0)/weekendHours.length : 0;
  createChart('hoursChart', 'bar', ['평일','주말'], [avgWeekdayHours.toFixed(1), avgWeekendHours.toFixed(1)], '평균 운영시간(시간)');
  createChart('regionChart', 'bar', regionCounts.slice(0,10).map(x=>x[0]), regionCounts.slice(0,10).map(x=>x[1]), '시설 수');

  populateFilters(typeCounts, regionCounts);
  renderTable(rawData);
  renderMap(rawData);
}

function populateFilters(typeCounts, regionCounts) {
  $('filterRegion').innerHTML = '<option value="">전체 지역</option>' + regionCounts.map(([x])=>`<option value="${x}">${x}</option>`).join('');
  $('filterType').innerHTML = '<option value="">전체 시설유형</option>' + typeCounts.map(([x])=>`<option value="${x}">${x}</option>`).join('');
}

function filteredData() {
  const region = $('filterRegion').value, type = $('filterType').value, paid = $('filterPaid').value, weekend = $('filterWeekend').value;
  const keyword = $('filterKeyword').value.trim().toLowerCase();
  return rawData.filter(r => {
    const text = `${clean(r['개방시설명'])} ${clean(r['관리기관명'])} ${clean(r['제공기관명'])}`.toLowerCase();
    return (!region || getRegion(r) === region) && (!type || clean(r['개방시설유형구분']) === type) &&
      (!paid || clean(r['유료사용여부']).toUpperCase() === paid) && (!weekend || (isWeekendOpen(r) ? 'Y' : 'N') === weekend) &&
      (!keyword || text.includes(keyword));
  });
}

function renderTable(data) {
  const tbody = $('facilityTableBody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">조건에 맞는 시설이 없습니다.</td></tr>'; return; }
  tbody.innerHTML = data.slice(0, 200).map(r => `<tr>
    <td><strong>${clean(r['개방시설명']) || '-'}</strong></td><td>${getRegion(r)}</td><td>${clean(r['개방시설유형구분']) || '-'}</td>
    <td>${num(r['수용가능인원수']) ? fmt(num(r['수용가능인원수'])) + '명' : '-'}</td>
    <td>${clean(r['유료사용여부']).toUpperCase()==='Y' ? fmt(num(r['사용료'])) + '원' : '무료'}</td>
    <td>${clean(r['평일운영시작시각']) || '-'} ~ ${clean(r['평일운영종료시각']) || '-'}</td>
    <td>${clean(r['주말운영시작시각']) || '-'} ~ ${clean(r['주말운영종료시각']) || '-'}</td><td>${clean(r['사용안내전화번호']) || '-'}</td></tr>`).join('');
}

function renderMap(data) {
  if (typeof L === 'undefined') return;
  if (!map) {
    map = L.map('map').setView([36.4, 127.8], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  markerLayer.clearLayers();
  const pts = [];
  data.forEach(r => {
    const lat = Number(r['위도']), lng = Number(r['경도']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return;
    pts.push([lat,lng]);
    const fee = clean(r['유료사용여부']).toUpperCase()==='Y' ? `${fmt(num(r['사용료']))}원` : '무료';
    L.marker([lat,lng]).bindPopup(`<strong>${clean(r['개방시설명']) || '시설명 미상'}</strong><br>${clean(r['개방시설유형구분']) || '유형 미상'} · ${fee}<br>수용 ${fmt(num(r['수용가능인원수']))}명<br>${clean(r['소재지도로명주소']) || ''}`).addTo(markerLayer);
  });
  if (pts.length) map.fitBounds(pts, { padding: [30,30], maxZoom: 13 });
  setTimeout(() => map.invalidateSize(), 100);
}

const fileInput = $('csvFile');
const uploadBox = document.querySelector('.upload-box');
fileInput.addEventListener('change', (e) => loadCSVFile(e.target.files?.[0]));

// 드래그 앤 드롭 지원
['dragenter','dragover'].forEach(evt => uploadBox.addEventListener(evt, e => { e.preventDefault(); uploadBox.classList.add('dragover'); }));
['dragleave','drop'].forEach(evt => uploadBox.addEventListener(evt, e => { e.preventDefault(); uploadBox.classList.remove('dragover'); }));
uploadBox.addEventListener('drop', e => loadCSVFile(e.dataTransfer.files?.[0]));

['filterRegion','filterType','filterPaid','filterWeekend'].forEach(id => $(id).addEventListener('change', () => { const data = filteredData(); renderTable(data); renderMap(data); }));
$('filterKeyword').addEventListener('input', () => { const data = filteredData(); renderTable(data); renderMap(data); });

const observer = new IntersectionObserver((entries) => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
