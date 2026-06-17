import { api } from './api.js';
import { $, toast, isVideo } from './helpers.js';
import { state } from './state.js';
import { openImagePicker } from './img-picker.js';
import { silentRefresh } from './router.js';
import { clearSelection } from './selection.js';

let audioPath = null;

function naturalSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function selectedVideos() {
  return state.currentItems
    .filter(i => !i.isDir && state.selectedFiles.has(i.path) && isVideo(i.name))
    .sort(naturalSort);
}

function setAudio(path) {
  audioPath = path;
  if (path) {
    $('join-audio-name').textContent = path.split('/').pop();
    $('join-audio-clear').style.display = '';
  } else {
    $('join-audio-name').textContent = 'No audio (silent)';
    $('join-audio-clear').style.display = 'none';
  }
}

function openJoinDialog() {
  const clips = selectedVideos();
  if (clips.length < 2) { toast('Select 2 or more videos', 'warning'); return; }

  const list = $('join-clip-list');
  list.innerHTML = '';
  clips.forEach(c => {
    const li = document.createElement('li');
    li.textContent = c.name;
    list.appendChild(li);
  });

  setAudio(null);
  $('join-output-name').value = '';
  $('join-status').textContent = '';
  $('join-confirm').loading = false;
  $('join-dialog').show();
}

$('join-audio-btn').addEventListener('click', () => {
  openImagePicker({
    kind: 'video',
    returnPath: true,
    onSelect: info => setAudio(info.path),
    onClear: () => setAudio(null),
  });
});

$('join-audio-clear').addEventListener('click', () => setAudio(null));

$('join-cancel').addEventListener('click', () => $('join-dialog').hide());

$('join-confirm').addEventListener('click', async () => {
  const clips = selectedVideos();
  if (clips.length < 2) { $('join-dialog').hide(); return; }

  const btn = $('join-confirm');
  btn.loading = true;
  $('join-status').textContent = 'Joining…';

  try {
    const { output } = await api.join({
      paths: clips.map(c => c.path),
      audioPath: audioPath || undefined,
      outputName: $('join-output-name').value.trim() || undefined,
    });
    $('join-dialog').hide();
    clearSelection();
    await silentRefresh();
    toast(`Joined ${clips.length} clips → ${output.split('/').pop()}`);
  } catch (err) {
    $('join-status').textContent = '';
    toast(`Join failed: ${err.message}`, 'danger');
  } finally {
    btn.loading = false;
  }
});

$('btn-bulk-join').addEventListener('click', openJoinDialog);
