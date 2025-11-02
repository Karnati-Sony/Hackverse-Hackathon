// BrickRate HackVerse Edition - frontend-only
// Features: local signup/login, Google Maps detect, voice assistant, chart, save & download
// NOTE: Replace Google Maps API key in index.html before using detect city features

// ---------- Config / city rates ----------
const CITY_RATES = {
  'metro': {min: 2200, max: 4000},
  'tier2': {min: 1400, max: 2600},
  'tier3': {min: 1000, max: 1800}
};
const TYPE_FACTOR = {'1bhk':0.95,'2bhk':1.0,'kothi':1.15};
const SPLIT = {materials:0.55, labor:0.30, professional:0.08, contingency:0.07};

// ---------- DOM ----------
const lengthEl = document.getElementById('length');
const widthEl = document.getElementById('width');
const cityEl = document.getElementById('city');
const houseTypeEl = document.getElementById('houseType');
const floorsEl = document.getElementById('floors');
const rateOverrideEl = document.getElementById('rateOverride');

const estimateBtn = document.getElementById('estimateBtn');
const saveBtn = document.getElementById('saveBtn');
const downloadBtn = document.getElementById('downloadBtn');
const detectCityBtn = document.getElementById('detectCity');
const aiLoader = document.getElementById('aiLoader');

const resultPanel = document.getElementById('resultPanel');
const summaryDiv = document.getElementById('summary');
const savedListDiv = document.getElementById('savedList');
const breakdownCanvas = document.getElementById('breakdownChart');

const loginBtn = document.getElementById('loginBtn');
const authModal = document.getElementById('authModal');
const authEmail = document.getElementById('authEmail');
const authPass = document.getElementById('authPass');
const doSignup = document.getElementById('doSignup');
const doLogin = document.getElementById('doLogin');
const closeAuth = document.getElementById('closeAuth');
const welcomeUser = document.getElementById('welcomeUser');

const voiceBtn = document.getElementById('voiceBtn');
const themeToggle = document.getElementById('themeToggle');

let chart = null;
let lastEstimate = null;

// ---------- Utilities ----------
function sqmToSqft(sqm){ return sqm * 10.7639; }
function formatINR(num){
  return '₹' + Math.round(num).toLocaleString('en-IN');
}
function toast(msg, t=2500){
  const el = document.getElementById('toast');
  el.innerText = msg; el.style.display='block';
  setTimeout(()=> el.style.display='none', t);
}

// ---------- Auth (localStorage based) ----------
const USERS_KEY = 'brickrate_users_v1';
const SESSION_KEY = 'brickrate_session_v1';

function loadUsers(){ return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); }
function saveUsers(u){ localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

function signup(email, pass){
  const users = loadUsers();
  if(users[email]){ toast('Email already exists'); return false; }
  users[email] = { password: pass, created: new Date().toISOString() };
  saveUsers(users);
  localStorage.setItem(SESSION_KEY, JSON.stringify({email, ts: new Date().toISOString()}));
  return true;
}
function login(email, pass){
  const users = loadUsers();
  if(!users[email] || users[email].password !== pass){ toast('Invalid credentials'); return false; }
  localStorage.setItem(SESSION_KEY, JSON.stringify({email, ts: new Date().toISOString()}));
  return true;
}
function logout(){
  localStorage.removeItem(SESSION_KEY);
  welcomeUser.innerText = '';
}

function getSessionUser(){ const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); return s ? s.email : null; }

function showAuthModal(show=true){
  authModal.style.display = show ? 'flex' : 'none';
}

// Auth UI events
loginBtn.addEventListener('click', ()=> showAuthModal(true));
closeAuth.addEventListener('click', ()=> showAuthModal(false));
doSignup.addEventListener('click', ()=>{
  const e = authEmail.value.trim(), p = authPass.value;
  if(!e || !p){ toast('fill email & password'); return; }
  if(signup(e,p)){ showAuthModal(false); onLogin(); toast('Signed up & logged in'); }
});
doLogin.addEventListener('click', ()=>{
  const e = authEmail.value.trim(), p = authPass.value;
  if(!e || !p){ toast('fill email & password'); return; }
  if(login(e,p)){ showAuthModal(false); onLogin(); toast('Welcome back'); }
});

function onLogin(){
  const user = getSessionUser();
  if(user){ welcomeUser.innerText = `Welcome, ${user.split('@')[0]}!`; loginBtn.innerText = 'Logout'; }
  else { welcomeUser.innerText = ''; loginBtn.innerText = 'Login / Sign up'; }
}
loginBtn.addEventListener('click',()=>{
  if(getSessionUser()){ logout(); onLogin(); toast('Logged out'); }
  else showAuthModal(true);
});
onLogin();

// ---------- Google Maps detect city ----------
function detectCity(){
  if(!navigator.geolocation){ toast('Geolocation not available'); return; }
  toast('Detecting location — allow browser location permission');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    // Use Google Maps Geocoder (loaded via script tag)
    if(window.google && window.google.maps){
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ location: {lat, lng} }, (results, status) => {
        if(status === 'OK' && results && results.length){
          // find locality or administrative_area_level_1
          let city = '';
          for(const comp of results[0].address_components){
            if(comp.types.includes('locality')){ city = comp.long_name; break; }
            if(comp.types.includes('administrative_area_level_2')) city = comp.long_name;
            if(comp.types.includes('administrative_area_level_1') && !city) city = comp.long_name;
          }
          cityEl.value = city || results[0].formatted_address;
          toast('City detected: ' + cityEl.value);
        } else {
          cityEl.value = 'Unknown';
          toast('Could not detect city. Try typing');
        }
      });
    } else {
      toast('Google Maps library not loaded. Add API key in index.html');
    }
  }, err => { toast('Location permission denied or error'); });
}
detectCityBtn.addEventListener('click', detectCity);

// ---------- Estimation logic ----------
function getCityRateByName(name){
  if(!name) return CITY_RATES.tier2;
  const n = name.toLowerCase();
  if(n.includes('mumbai')||n.includes('delhi')||n.includes('bangalore')||n.includes('chennai')||n.includes('kolkata')) return CITY_RATES.metro;
  if(n.includes('pune')||n.includes('jaipur')||n.includes('coimbatore')||n.includes('lucknow')) return CITY_RATES.tier2;
  return CITY_RATES.tier3;
}

function runEstimate(){
  // gather
  const L = Number(lengthEl.value) || 0;
  const W = Number(widthEl.value) || 0;
  const floors = Math.max(1, Number(floorsEl.value) || 1);
  const cityName = cityEl.value.trim();
  const house = houseTypeEl.value;
  const overrideRate = Number(rateOverrideEl.value) || null;

  // area
  const areaM = Number((L * W).toFixed(4));
  const areaFt = Math.round(sqmToSqft(areaM));

  // built-up approx
  const builtUpFactor = 0.6; // assumption
  const builtUp = Math.round(areaFt * builtUpFactor * floors);

  // rate
  const baseRate = overrideRate || ((cityName) ? getCityRateByName(cityName).min : CITY_RATES.tier2.min);
  const rateRange = overrideRate ? {min: baseRate, max: baseRate} : getCityRateByName(cityName);

  // apply type factor
  const typeFactor = TYPE_FACTOR[house] || 1.0;
  const minTotal = Math.round(builtUp * rateRange.min * typeFactor);
  const maxTotal = Math.round(builtUp * rateRange.max * typeFactor);
  const avg = Math.round((minTotal + maxTotal) / 2);

  // breakdown
  const materials = Math.round(avg * SPLIT.materials);
  const labor = Math.round(avg * SPLIT.labor);
  const prof = Math.round(avg * SPLIT.professional);
  const cont = Math.round(avg * SPLIT.contingency);

  lastEstimate = {
    ts: new Date().toISOString(),
    areaM, areaFt, builtUp, floors, cityName, house, minTotal, maxTotal, avg, materials, labor, prof, cont
  };

  // show
  showResult(lastEstimate);
}

// show loading + fake AI feeling
estimateBtn.addEventListener('click', ()=>{
  aiLoader.style.display='flex';
  resultPanel.style.display='none';
  setTimeout(()=>{ aiLoader.style.display='none'; runEstimate(); }, 1100);
});

// ---------- Render results ----------
function showResult(e){
  resultPanel.style.display='block';
  const user = getSessionUser();
  if(user) welcomeUser.innerText = `Welcome, ${user.split('@')[0]}!`;

  summaryDiv.innerHTML = `
    <div><strong>Plot:</strong> ${e.areaM} m² (${e.areaFt} sq.ft)</div>
    <div><strong>Built-up (est):</strong> ${e.builtUp} sq.ft — ${e.floors} floor(s)</div>
    <div><strong>City:</strong> ${e.cityName || '—'}</div>
    <div style="margin-top:8px"><strong>Estimated Range:</strong>
      <div style="font-size:1.15rem;margin-top:6px">${formatINR(e.minTotal)} — ${formatINR(e.maxTotal)}</div>
      <div class="small muted">Average: ${formatINR(e.avg)}</div>
    </div>
  `;

  renderChart(e);
  renderSavedList();
  // speak results
  speak(`Estimated cost range is ${e.minTotal} to ${e.maxTotal} rupees. Average ${e.avg} rupees.`);
}

// ---------- Chart ----------
function renderChart(e){
  const labels=['Materials','Labor','Professional','Contingency'];
  const data=[e.materials,e.labor,e.prof,e.cont];
  if(chart) chart.destroy();
  chart = new Chart(breakdownCanvas.getContext('2d'), {
    type:'pie',
    data:{labels, datasets:[{data, backgroundColor:['#60a5fa','#34d399','#f59e0b','#f87171']}]},
    options:{plugins:{legend:{position:'bottom'}}}
  });
}

// ---------- Save & Download ----------
const QUOTES_KEY = 'brickrate_quotes_v1';
function saveQuote(){
  if(!lastEstimate){ toast('Run an estimate first'); return; }
  const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]');
  quotes.unshift(lastEstimate);
  if(quotes.length>30) quotes.length = 30;
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  toast('Quote saved locally');
  renderSavedList();
}
saveBtn.addEventListener('click', ()=>{
  const user = getSessionUser();
  if(!user){ toast('Please login to save quotes'); showAuthModal(true); return; }
  saveQuote();
});

function renderSavedList(){
  const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]');
  if(!quotes.length){ savedListDiv.innerHTML = `<div class="small muted">No saved quotes yet</div>`; return; }
  savedListDiv.innerHTML = quotes.map((q, i) => {
    return `<div class="savedItem">
      <div><strong>${formatINR(q.avg)}</strong><div class="small muted">${new Date(q.ts).toLocaleString()}</div></div>
      <div><button onclick='loadQuote(${i})'>Load</button> <button onclick='deleteQuote(${i})' class='mini'>Delete</button></div>
    </div>`;
  }).join('');
}
window.loadQuote = function(i){
  const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]');
  const q = quotes[i];
  if(!q) return;
  lengthEl.value = (Math.sqrt(q.areaM) || 10).toFixed(2); // heuristic reload
  widthEl.value = (Math.sqrt(q.areaM) || 8).toFixed(2);
  floorsEl.value = q.floors;
  cityEl.value = q.cityName || '';
  houseTypeEl.value = q.house;
  runEstimate();
}
window.deleteQuote = function(i){
  const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || '[]');
  quotes.splice(i,1);
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  renderSavedList();
  toast('Deleted');
}

// Download PDF using html2canvas + jsPDF
downloadBtn.addEventListener('click', async ()=>{
  if(!lastEstimate){ toast('Run an estimate first'); return; }
  // create a node to render
  const node = document.createElement('div');
  node.style.width = '800px';
  node.style.padding = '20px';
  node.style.background = '#fff';
  node.innerHTML = `<h2>BrickRate Estimate</h2>
    <div><b>City:</b> ${lastEstimate.cityName || '—'}</div>
    <div><b>Plot Area:</b> ${lastEstimate.areaM} m² (${lastEstimate.areaFt} sq.ft)</div>
    <div><b>Built-up (est):</b> ${lastEstimate.builtUp} sq.ft — ${lastEstimate.floors} floor(s)</div>
    <div style="margin-top:8px;"><b>Estimated Range:</b> ${formatINR(lastEstimate.minTotal)} — ${formatINR(lastEstimate.maxTotal)}</div>
    <hr>
    <div><b>Breakdown</b></div>
    <div>Materials: ${formatINR(lastEstimate.materials)}</div>
    <div>Labor: ${formatINR(lastEstimate.labor)}</div>
    <div>Professional: ${formatINR(lastEstimate.prof)}</div>
    <div>Contingency: ${formatINR(lastEstimate.cont)}</div>
    <div style="margin-top:8px;"><small>Generated by BrickRate — HackVerse 2025</small></div>
  `;
  document.body.appendChild(node);
  const canvas = await html2canvas(node, {scale:1.6});
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jspdf.jsPDF('p','pt','a4');
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = (canvas.height * pdfW) / canvas.width;
  pdf.addImage(imgData, 'PNG', 20, 20, pdfW-40, pdfH);
  pdf.save(`BrickRate_Estimate_${(new Date()).toISOString().slice(0,19)}.pdf`);
  node.remove();
});

// ---------- Voice assistant (recognition + speak) ----------
let recognition = null;
if('webkitSpeechRecognition' in window || 'SpeechRecognition' in window){
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new Rec();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (ev) => {
    const text = ev.results[0][0].transcript;
    toast('Heard: ' + text, 2500);
    handleVoiceCommand(text.toLowerCase());
  };
  recognition.onerror = (e)=> toast('Voice error: ' + e.error);
} else {
  voiceBtn.disabled = true;
  voiceBtn.title = 'Speech recognition not supported in this browser';
}

voiceBtn.addEventListener('click', ()=>{
  if(!recognition){ toast('Voice not supported'); return; }
  recognition.start();
  toast('Listening...');
});

function speak(text){
  if(!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-IN';
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

function handleVoiceCommand(text){
  // very simple parsing: numbers & keywords
  // examples user might say:
  // "estimate 2 bhk in Bhopal 10 by 8"
  const nums = text.match(/[\d]+(\.\d+)?/g) || [];
  if(text.includes('estimate') || text.includes('calculate')){
    // attempt to extract length & width & floors & house type & city
    let l = nums[0] || lengthEl.value;
    let w = nums[1] || widthEl.value;
    let floors = nums[2] || floorsEl.value;
    if(!floors) floors = 1;
    lengthEl.value = l; widthEl.value = w; floorsEl.value = floors;
    // house type
    if(text.includes('1 bhk')||text.includes('one bhk')) houseTypeEl.value='1bhk';
    if(text.includes('2 bhk')||text.includes('two bhk')||text.includes('2bhk')) houseTypeEl.value='2bhk';
    if(text.includes('kothi')||text.includes('villa')||text.includes('large')) houseTypeEl.value='kothi';
    // city
    const afterIn = text.split(' in ');
    if(afterIn.length>1){ cityEl.value = afterIn[1].split(' ')[0]; }
    // run estimate
    aiLoader.style.display='flex';
    setTimeout(()=>{ aiLoader.style.display='none'; runEstimate(); }, 900);
  } else if(text.includes('save')){
    saveBtn.click();
  } else if(text.includes('download')|| text.includes('pdf')){
    downloadBtn.click();
  } else {
    toast('Voice command not recognized. Try: "Estimate 2 BHK in Bhopal 10 by 8"');
  }
}

// ---------- Theme toggle ----------
themeToggle.addEventListener('click', ()=>{
  document.body.classList.toggle('dark');
  themeToggle.innerText = document.body.classList.contains('dark') ? '☀️' : '🌙';
});

// ---------- init ----------
function init(){
  renderSavedList();
  onLogin();
}
init();
