const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const oszDir = path.join('C:\\Users\\XAKEP\\Downloads');
const workDir = path.join(__dirname, 'tracks');

fs.mkdirSync(workDir, { recursive: true });

function parseOsu(content) {
  const lines = content.split(/\r?\n/);
  const result = { metadata: {}, difficulty: {}, general: {}, timingPoints: [], hitObjects: [] };
  let section = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      section = trimmed.slice(1, -1);
      continue;
    }
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (section === 'General') {
      const [key, ...rest] = trimmed.split(':');
      const val = rest.join(':').trim();
      result.general[key.trim()] = isNaN(val) ? val : parseFloat(val);
    } else if (section === 'Metadata') {
      const [key, ...rest] = trimmed.split(':');
      result.metadata[key.trim()] = rest.join(':').trim();
    } else if (section === 'Difficulty') {
      const [key, val] = trimmed.split(':');
      result.difficulty[key.trim()] = parseFloat(val);
    } else if (section === 'TimingPoints') {
      const parts = trimmed.split(',');
      const offset = parseFloat(parts[0]);
      const beatLength = parseFloat(parts[1]);
      const inherited = parts[6] === '0';
      result.timingPoints.push({ offset, beatLength, inherited });
    } else if (section === 'HitObjects') {
      const parts = trimmed.split(',');
      const x = parseInt(parts[0]);
      const time = parseInt(parts[2]);
      const type = parseInt(parts[3]);
      const numCols = result.difficulty.CircleSize || 4;

      const mode = result.general.Mode || 0;

      if (mode === 3) {
        const isHold = (type & 128) !== 0;
        let endTime = null;
        if (isHold) {
          const endPart = parts.find(p => p.includes(':'));
          if (endPart) {
            const endVal = parseInt(endPart.split(':')[0]);
            if (!isNaN(endVal)) endTime = endVal;
          }
        }
        const column = Math.min(numCols - 1, Math.floor(x / (512 / numCols)));
        const hitSound = parseInt(parts[4]) || 0;
        result.hitObjects.push({ x, time, type, column, isHold, endTime, hitSound });
      } else {
        const isCircle = (type & 1) !== 0;
        const isSlider = (type & 2) !== 0;
        const isSpinner = (type & 8) !== 0;
        const column = Math.min(Math.max(numCols, 4) - 1, Math.floor(x / (512 / Math.max(numCols, 4))));

        if (isSpinner) {
          const endTime = parseInt(parts[5]) || time + 1000;
          result.hitObjects.push({ x, time, type, column, isHold: true, endTime, hitSound: 0 });
        } else if (isSlider) {
          const pixelLength = parseFloat(parts[6]) || 0;
          const repeats = parseInt(parts[7]) || 1;
          let activeBeat = 600;
          for (const tp of result.timingPoints) {
            if (!tp.inherited && tp.offset <= time) activeBeat = tp.beatLength;
          }
          let svMult = 1;
          for (const tp of result.timingPoints) {
            if (tp.inherited && tp.offset <= time) svMult = Math.max(0.1, -100 / tp.beatLength);
          }
          const sv = (result.difficulty.SliderMultiplier || 1.4) * svMult;
          const duration = (pixelLength / (sv * 100)) * activeBeat * repeats;
          const endTime = Math.round(time + duration);
          if (duration > 100) {
            result.hitObjects.push({ x, time, type, column, isHold: true, endTime, hitSound: 0 });
          } else {
            result.hitObjects.push({ x, time, type, column, isHold: false, endTime: null, hitSound: 0 });
          }
        } else if (isCircle) {
          result.hitObjects.push({ x, time, type, column, isHold: false, endTime: null, hitSound: 0 });
        }
      }
    }
  }
  return result;
}

function calculateBPM(timingPoints) {
  const uninherited = timingPoints.filter(tp => !tp.inherited && tp.beatLength > 0);
  if (uninherited.length === 0) return 0;
  const avgBeatLength = uninherited.reduce((s, tp) => s + tp.beatLength, 0) / uninherited.length;
  return Math.round(60000 / avgBeatLength);
}

function makeSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const oszFiles = fs.readdirSync(oszDir).filter(f => f.endsWith('.osz'));
const tracks = [];

for (const oszFile of oszFiles) {
  const zip = new AdmZip(path.join(oszDir, oszFile));
  const entries = zip.getEntries();

  const osuEntries = entries.filter(e => e.entryName.endsWith('.osu'));
  if (osuEntries.length === 0) {
    console.log(`Skipping ${oszFile}: no .osu files`);
    continue;
  }

  const firstOsu = parseOsu(osuEntries[0].getData().toString('utf-8'));
  const slug = makeSlug(firstOsu.metadata.Artist + '-' + firstOsu.metadata.Title);
  const trackDir = path.join(workDir, slug);
  fs.mkdirSync(trackDir, { recursive: true });

  console.log(`\n--- ${firstOsu.metadata.Artist} - ${firstOsu.metadata.Title} (${osuEntries.length} diffs) ---`);

  const difficulties = [];
  for (const entry of osuEntries) {
    const data = parseOsu(entry.getData().toString('utf-8'));
    const mode = data.general.Mode || (data.hitObjects.some(h => (h.type & 128) !== 0) ? 3 : 0);
    const isConvert = mode !== 3;
    if (isConvert) data.difficulty.CircleSize = Math.max(data.difficulty.CircleSize || 4, 4);
    const version = (isConvert ? '[Convert] ' : '') + (data.metadata.Version || path.basename(entry.entryName, '.osu'));

    const sorted = [...data.hitObjects].sort((a, b) => a.time - b.time);
    const breaks = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const prevEnd = (prev.isHold && prev.endTime) ? prev.endTime : prev.time;
      const gap = sorted[i].time - prevEnd;
      if (gap >= 3000) {
        breaks.push({ start: prevEnd, end: sorted[i].time });
      }
    }

    difficulties.push({
      version,
      fileName: entry.entryName,
      difficulty: data.difficulty,
      timingPoints: data.timingPoints,
      hitObjects: data.hitObjects,
      noteCount: data.hitObjects.length,
      bpm: calculateBPM(data.timingPoints),
      breaks
    });
    console.log(`  ${version}: ${data.hitObjects.length} notes, ${data.difficulty.CircleSize}K, OD ${data.difficulty.OverallDifficulty}${isConvert ? ' (standard→mania)' : ''}, ${breaks.length} breaks`);
  }

  difficulties.sort((a, b) => {
    const aOD = a.difficulty?.OverallDifficulty || 0;
    const bOD = b.difficulty?.OverallDifficulty || 0;
    if (aOD !== bOD) return aOD - bOD;
    return a.noteCount - b.noteCount;
  });

  let audioFile = '';
  let bgFile = '';

  const hitsoundPattern = /^(clap|snare|kick|hitnormal|hitclap|hitwhistle|finish|open|soft|normal|drum|b8s|hat)/i;
  const audioEntries = entries.filter(e => /\.(mp3|ogg|wav)$/i.test(e.entryName) && !hitsoundPattern.test(path.basename(e.entryName).replace(/\.[^.]+$/, '')));
  const audioEntry = audioEntries.sort((a, b) => b.header.size - a.header.size)[0] || entries.find(e => /\.(mp3|ogg)$/i.test(e.entryName));
  if (audioEntry) {
    const ext = path.extname(audioEntry.entryName);
    audioFile = 'audio' + ext;
    fs.writeFileSync(path.join(trackDir, audioFile), audioEntry.getData());
    console.log(`  Audio: ${audioEntry.entryName} -> ${audioFile}`);
  }

  const bgPattern = /^(pause|combo|score|hit|slider|spinner|cursor|menu|play|fail|pass|overlay|ranking|default|lighting)/i;
  const bgEntries = entries.filter(e => /\.(jpg|jpeg|png)$/i.test(e.entryName) && !e.isDirectory && !bgPattern.test(path.basename(e.entryName).replace(/\.[^.]+$/, '')));
  const bgEntry = bgEntries.sort((a, b) => b.header.size - a.header.size)[0];
  if (bgEntry) {
    const ext = path.extname(bgEntry.entryName);
    bgFile = 'bg' + ext;
    fs.writeFileSync(path.join(trackDir, bgFile), bgEntry.getData());
    console.log(`  BG: ${bgEntry.entryName} -> ${bgFile}`);
  }

  const beatmapData = {
    title: firstOsu.metadata.Title || 'Unknown',
    titleUnicode: firstOsu.metadata.TitleUnicode || '',
    artist: firstOsu.metadata.Artist || 'Unknown',
    artistUnicode: firstOsu.metadata.ArtistUnicode || '',
    audioFile: audioFile,
    backgroundFile: bgFile,
    difficulties
  };

  fs.writeFileSync(path.join(trackDir, 'data.json'), JSON.stringify(beatmapData, null, 2));

  tracks.push({
    id: slug,
    title: beatmapData.title,
    titleUnicode: beatmapData.titleUnicode,
    artist: beatmapData.artist,
    artistUnicode: beatmapData.artistUnicode,
    audioFile: `tracks/${slug}/${audioFile}`,
    bgFile: bgFile ? `tracks/${slug}/${bgFile}` : '',
    diffCount: difficulties.length,
    totalNotes: difficulties.reduce((s, d) => s + d.noteCount, 0)
  });
}

tracks.sort((a, b) => a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist));

fs.writeFileSync(path.join(__dirname, 'tracks.json'), JSON.stringify(tracks, null, 2));
console.log(`\n=== Done: ${tracks.length} tracks saved to tracks.json ===`);
for (const t of tracks) {
  console.log(`  ${t.artist} - ${t.title} (${t.diffCount} diffs, ${t.totalNotes} notes)`);
}
