import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  Circle,
  FileText,
  Power,
  RotateCw,
  Square,
  WandSparkles,
  ZoomIn,
  ZoomOut,
  Maximize,
  RefreshCw,
  Compass,
  Terminal,
  FolderUp,
  Folder,
  Settings,
  Globe,
  Wifi,
  Code,
  MoreVertical,
  X,
  Volume2,
  VolumeX,
  Play,
  Trash2,
  Download,
  Package,
  Layers,
  Sliders,
  Smartphone
} from 'lucide-react';
import './DevicePage.css';
import DashboardTab from './device-page/DashboardTab';
import DeviceTabsHeader from './device-page/DeviceTabsHeader';
import FilesTab from './device-page/FilesTab';
import MediaTab from './device-page/MediaTab';
import InfoTab from './device-page/InfoTab';
import PlaceholderTab from './device-page/PlaceholderTab';
import AutomationTab from './device-page/AutomationTab';
import { COORDINATOR_API, deviceApiUrl, streamWSUrl } from '../lib/config';
function DevicePage({ device, token, onBack, onRelease }) {
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const onWSMessageRef = useRef(null);
  const canvasClickHandlerRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [touchIndicator, setTouchIndicator] = useState(null);
  const [zoom, setZoom] = useState(1.0);
  const [activeSideDrawer, setActiveSideDrawer] = useState(null);
  const [volumeLevel, setVolumeLevel] = useState(70);
  const [shellOutput, setShellOutput] = useState('');
  const [shellExecuting, setShellExecuting] = useState(false);
  const autoRefreshTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
      }
    };
  }, []);

  const triggerAutoRefreshTree = (delay = 800) => {
    if (activeTab !== 'automation') return;
    if (autoRefreshTimeoutRef.current) {
      clearTimeout(autoRefreshTimeoutRef.current);
    }
    autoRefreshTimeoutRef.current = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'DUMP_UI' }));
      }
    }, delay);
  };
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);

  const [shellCmd, setShellCmd] = useState('');
  const [navUrl, setNavUrl] = useState('');

  // Media (screenshot/recording) state
  const [screenshot, setScreenshot] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaFiles, setMediaFiles] = useState([]);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const takeScreenshot = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/jpeg', 0.9);
    const newMedia = {
      id: Date.now(),
      type: 'image',
      name: `Screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`,
      time: new Date().toLocaleString(),
      url: url,
    };
    setScreenshot(newMedia);
    setMediaFiles(prev => [newMedia, ...prev]);
  };

  const startRecording = () => {
    if (!canvasRef.current) return;
    try {
      const stream = canvasRef.current.captureStream(30);
      let options = { mimeType: 'video/webm;codecs=vp9' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
      }
      const recorder = new MediaRecorder(stream, options);
      recordedChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const newMedia = {
          id: Date.now(),
          type: 'video',
          name: `Recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
          time: new Date().toLocaleString(),
          url: url,
          blob: blob
        };
        setMediaFiles(prev => [newMedia, ...prev]);
        setRecording(false);
      };
      
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (e) {
      console.error("Failed to start recording:", e);
      alert("Screen recording is not supported in this browser.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const downloadMedia = (file) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const deleteMedia = (file) => {
    setMediaFiles(prev => prev.filter(m => m.id !== file.id));
    if (screenshot && screenshot.id === file.id) {
      setScreenshot(null);
    }
  };

  const refreshMedia = () => {
    // Client-side only
  };

  const copyPath = (path) => {
    navigator.clipboard.writeText(path || '');
  };

  const execShell = async (command) => {
    try {
      const res = await fetch(`${COORDINATOR_API}/api/v1/devices/${device.serial}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'shell', command })
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Shell error", err);
      return { success: false, message: err.message };
    }
  };

  const [uploadProgress, setUploadProgress] = useState({
    active: false,
    stage: '', // 'uploading', 'installing', 'opening', 'done', 'error'
    percent: 0,
    message: '',
    type: ''
  });

  const handleFileUpload = (file, type) => {
    if (!wsUrl) return;
    // Upload via the coordinator proxy (same-origin with the API). XHR is
    // used for upload progress, so it bypasses the fetch wrapper — the
    // Authorization header must be set explicitly.
    const uploadUrl = deviceApiUrl(device.serial, 'upload');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    setUploadProgress({
      active: true,
      stage: 'uploading',
      percent: 0,
      message: 'Preparing upload...',
      type: type
    });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    // Track upload progress (network phase, 0% to 50% of the progress bar)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const uploadPercent = Math.round((e.loaded / e.total) * 100);
        const overallPercent = Math.round(uploadPercent * 0.5);
        setUploadProgress({
          active: true,
          stage: 'uploading',
          percent: overallPercent,
          message: `Uploading file (${uploadPercent}%)`,
          type: type
        });
      }
    };

    let lastIndex = 0;

    const handleChunk = (chunk) => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.stage === 'installing') {
            setUploadProgress({
              active: true,
              stage: 'installing',
              percent: 75,
              message: data.message || 'Installing on device...',
              type: type
            });
          } else if (data.stage === 'opening') {
            setUploadProgress({
              active: true,
              stage: 'opening',
              percent: 90,
              message: data.message || 'Opening application...',
              type: type
            });
          } else if (data.stage === 'done') {
            setUploadProgress({
              active: true,
              stage: 'done',
              percent: 100,
              message: data.message || 'Completed!',
              type: type
            });
            setTimeout(() => {
              setUploadProgress(prev => {
                if (prev.type === type && prev.stage === 'done') {
                  return { active: false, stage: '', percent: 0, message: '', type: '' };
                }
                return prev;
              });
            }, 3000);
          } else if (data.stage === 'error') {
            setUploadProgress({
              active: true,
              stage: 'error',
              percent: 0,
              message: data.message || 'An error occurred',
              type: type
            });
            alert(`Upload Failed: ${data.message}`);
            setTimeout(() => {
              setUploadProgress(prev => {
                if (prev.type === type && prev.stage === 'error') {
                  return { active: false, stage: '', percent: 0, message: '', type: '' };
                }
                return prev;
              });
            }, 4000);
          }
        } catch (err) {
          console.error("Failed to parse progress chunk:", err);
        }
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const newText = xhr.responseText.substring(lastIndex);
        lastIndex = xhr.responseText.length;
        if (newText) {
          handleChunk(newText);
        }
      }

      if (xhr.readyState === 4) {
        if (xhr.status < 200 || xhr.status >= 300) {
          setUploadProgress(prev => {
            if (prev.type === type && prev.stage !== 'error' && prev.stage !== 'done') {
              alert(`Upload Error: Status ${xhr.status} ${xhr.statusText}`);
              return { active: false, stage: '', percent: 0, message: '', type: '' };
            }
            return prev;
          });
        }
      }
    };

    xhr.onerror = () => {
      setUploadProgress({
        active: true,
        stage: 'error',
        percent: 0,
        message: 'Network error occurred.',
        type: type
      });
      alert('Upload Error: Network failure');
      setTimeout(() => {
        setUploadProgress({ active: false, stage: '', percent: 0, message: '', type: '' });
      }, 4000);
    };

    xhr.send(formData);
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0], type);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDropzoneClick = (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'app' ? '.apk' : '*/*';
    input.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files[0], type);
      }
    };
    input.click();
  };

  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('devicePageOrder');
      return saved ? JSON.parse(saved) : [
        'app_upload', 'file_upload', 'maintenance', 'navigation', 
        'shell', 'apps', 'advanced_input', 'upload_server'
      ];
    } catch {
      return [
        'app_upload', 'file_upload', 'maintenance', 'navigation', 
        'shell', 'apps', 'advanced_input', 'upload_server'
      ];
    }
  });
  const [draggedCardIndex, setDraggedCardIndex] = useState(null);

  const handleCardDragStart = (e, index) => {
    setDraggedCardIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleCardDragOver = (e, index) => {
    e.preventDefault();
    if (draggedCardIndex === null || draggedCardIndex === index) return;
    
    const newOrder = [...cardOrder];
    const draggedItem = newOrder[draggedCardIndex];
    newOrder.splice(draggedCardIndex, 1);
    newOrder.splice(index, 0, draggedItem);
    
    setCardOrder(newOrder);
    localStorage.setItem('devicePageOrder', JSON.stringify(newOrder));
    setDraggedCardIndex(index);
  };

  const handleCardDragEnd = () => {
    setDraggedCardIndex(null);
  };

  // Parse initial aspect ratio from device display info (e.g. "1080x2400 @ 450dpi")
  const getInitialAspectRatio = () => {
    if (!device.display) return { ratio: '9 / 19.5', isLandscape: false };
    const match = device.display.match(/^(\d+)x(\d+)/);
    if (match) {
      const w = parseInt(match[1], 10);
      const h = parseInt(match[2], 10);
      if (w && h) {
        return { ratio: `${w} / ${h}`, isLandscape: w > h };
      }
    }
    return { ratio: '9 / 19.5', isLandscape: false };
  };

  const initial = getInitialAspectRatio();
  const [rotation, setRotation] = useState(initial.isLandscape ? 90 : 0);

  const streamPort = device.stream_port || device.streamPort;
  // Video/control WS and uploads go through the coordinator's reverse proxy
  // (same origin, works through the Cloudflare Tunnel). A stream is only
  // available once the device has been claimed (stream_port > 0).
  const wsUrl = streamPort ? streamWSUrl(device.serial, token) : null;
  const stateUrl = streamPort ? deviceApiUrl(device.serial, 'state') : null;

  // We no longer poll stateUrl because state is delivered via websocket (DEVICE_LIST_UPDATE)


  // ── Input event handlers ────────────────────────────────────────────────────

  const handleFolderClick = (path) => {
    execShell(`am broadcast -a com.protean.agent.COMMAND -e command "LIST_DIRECTORY" -e path "${path}"`);
  };

  const handleBackClick = (currentPath) => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    if (parts.length <= 2) return; // e.g. ["", "storage"] -> can't go higher
    parts.pop();
    const parentPath = parts.join('/');
    handleFolderClick(parentPath);
  };

  const sendTouchEvent = (action, normX, normY, button = 0, buttons = 1, pressure = 1.0, pointerId = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'touch', action, x: normX, y: normY, button, buttons, pressure, pointerId }));
    }
  };

  const sendScrollEvent = (normX, normY, vscroll) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'scroll', x: normX, y: normY, hscroll: 0, vscroll }));
    }
  };
  const sendControlKey = (keycode) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'key', keycode }));
    }
    triggerAutoRefreshTree(1000);
  };


  const getVideoNormCoords = (e) => {
    if (!canvasRef.current) return { x: 0.5, y: 0.5 };
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const isDragging = useRef(false);

  const handleMouseDown = (e) => {
    e.preventDefault();
    if (canvasRef.current) canvasRef.current.focus();
    
    const { x, y } = getVideoNormCoords(e);
    
    if (activeTab === 'automation' && canvasClickHandlerRef.current) {
      canvasClickHandlerRef.current(x, y);
      return;
    }
    
    setTouchIndicator({ x: x * 100, y: y * 100, id: Date.now() });
    isDragging.current = true;
    sendTouchEvent(0, x, y, e.button, e.buttons, 1.0, -1);
  };

  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    // iOS JPEG mode: skip MOVE — the backend accumulates gesture state synchronously.
    if (isIOSStreamRef.current) return;
    e.preventDefault();
    const { x, y } = getVideoNormCoords(e);
    sendTouchEvent(2, x, y, e.button, e.buttons, 1.0, -1);
  };

  const handleMouseUp = (e) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const { x, y } = getVideoNormCoords(e);
    sendTouchEvent(1, x, y, e.button, e.buttons, 0, -1);
    triggerAutoRefreshTree(800);
  };

  const handleContextMenu = (e) => e.preventDefault();

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();

    const controlKeyMap = {
      'Backspace': 67, 'Enter': 66, 'Tab': 61, 'Escape': 111,
      'ArrowLeft': 21, 'ArrowRight': 22, 'ArrowUp': 19, 'ArrowDown': 20,
      'Delete': 112,
    };

    const key = e.key;
    if (controlKeyMap[key] !== undefined) {
      sendControlKey(controlKeyMap[key]);
    } else if (key.length === 1 && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: key }));
      triggerAutoRefreshTree(800);
    }
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    
    if (activeTab === 'automation' && canvasClickHandlerRef.current && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const normX = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height));
      canvasClickHandlerRef.current(normX, normY);
      return;
    }
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const normX = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height));
      setTouchIndicator({ x: normX * 100, y: normY * 100, id: Date.now() + i });
      sendTouchEvent(0, normX, normY, 0, 0, 1.0, t.identifier);
    }
  };

  const handleTouchMove = (e) => {
    // iOS streams raw JPEG — MOVE events are accumulated server-side via the
    // gestureMu state machine. Sending them over WebSocket would only add latency
    // with zero benefit (the backend ignores MOVE for WDA calls).
    if (isIOSStreamRef.current) return;
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      sendTouchEvent(2,
        Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height)),
        0, 0, 1.0, t.identifier
      );
    }
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      sendTouchEvent(1,
        Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width)),
        Math.max(0, Math.min(1, (t.clientY - rect.top) / rect.height)),
        0, 0, 0, t.identifier
      );
    }
    triggerAutoRefreshTree(800);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const { x, y } = getVideoNormCoords(e);
    sendScrollEvent(x, y, e.deltaY > 0 ? -1 : 1);
    triggerAutoRefreshTree(1000);
  };
  // ── WebCodecs / JPEG streaming pipeline ────────────────────────────────────
  const videoWidthRef = useRef(0);
  const videoHeightRef = useRef(0);
  // True if this is an iOS device to skip mouse/touch move events for WDA gesture accumulation.
  const isIOSStreamRef = useRef(
    device.model?.toLowerCase().includes('iphone') ||
    device.model?.toLowerCase().includes('ipad') ||
    device.serial?.includes('-')
  );

  useEffect(() => {
    if (!wsUrl) return;
    let active = true;
    let decoder = null;
    let ws = null;
    // Hoisted here so the cleanup function (returned from useEffect) can access them.
    const jpegImg = new Image();
    let objUrl = null;

    if (!window.VideoDecoder) {
      setErrorMsg('WebCodecs is not supported in this browser. Ensure you are using a secure context (HTTPS) or accessing via localhost/127.0.0.1.');
      return;
    }
    let savedSPS = null;
    let savedPPS = null;
    let currentCodec = 'avc1.64002a';

    const processAnnexB = (chunk) => {
      const nals = [];
      let i = 0;
      const len = chunk.length;
      
      while (i < len) {
        if (i + 3 < len && chunk[i] === 0 && chunk[i+1] === 0 && chunk[i+2] === 0 && chunk[i+3] === 1) {
          nals.push({ start: i, header: i + 4 });
          i += 4;
        } else if (i + 2 < len && chunk[i] === 0 && chunk[i+1] === 0 && chunk[i+2] === 1) {
          nals.push({ start: i, header: i + 3 });
          i += 3;
        } else {
          i++;
        }
      }
      
      for (let k = 0; k < nals.length; k++) {
        nals[k].end = (k + 1 < nals.length) ? nals[k+1].start : len;
      }

      let hasIDR = false;
      
      for (const nal of nals) {
        if (nal.header >= len) continue;
        const nalType = chunk[nal.header] & 0x1f;
        if (nalType === 7) {
          savedSPS = chunk.slice(nal.start, nal.end);
        } else if (nalType === 8) {
          savedPPS = chunk.slice(nal.start, nal.end);
        } else if (nalType === 5) {
          hasIDR = true;
        }
      }

      const isConfigOnly = nals.length > 0 && nals.every(nal => {
        if (nal.header >= len) return true;
        const t = chunk[nal.header] & 0x1f;
        return t === 7 || t === 8 || t === 6 || t === 9; // SPS, PPS, SEI, AUD
      });

      return { hasIDR, isConfigOnly, nals };
    };

    const initDecoder = () => {
      try {
        decoder = new VideoDecoder({
          output: (frame) => {
            if (!active) {
              frame.close();
              return;
            }
            const w = frame.displayWidth;
            const h = frame.displayHeight;
            if (w && h && (w !== videoWidthRef.current || h !== videoHeightRef.current)) {
              videoWidthRef.current = w;
              videoHeightRef.current = h;
              setVideoWidth(w);
              setVideoHeight(h);
              setRotation(w > h ? 90 : 0);
            }

            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
              const ctx = canvas.getContext('2d');
              ctx.drawImage(frame, 0, 0, w, h);
            }
            setIsPlaying(true);
            frame.close();
          },
          error: (e) => {
            console.error('VideoDecoder error:', e);
            if (active) {
              setErrorMsg(`Decoder error: ${e.message}`);
            }
          }
        });

        decoder.configure({
          codec: currentCodec,
          optimizeForLatency: true
        });
      } catch (err) {
        console.error('Failed to initialize VideoDecoder:', err);
        setErrorMsg(`Decoder initialization failed: ${err.message}`);
      }
    };

    const startWebSocket = () => {
      console.log(`Connecting to WebSocket stream at: ${wsUrl}`);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      initDecoder();

      // ── RAF-gated JPEG renderer ─────────────────────────────────────────
      // Only one rAF is ever scheduled at a time.  When a new JPEG frame
      // arrives it just REPLACES pendingJpegBlob (latest-wins).  The rAF
      // callback decodes whichever blob is current when the browser is ready
      // to paint — all intermediate frames are silently discarded.  This
      // prevents the async createImageBitmap queue from growing unboundedly
      // and ensures the canvas always shows the freshest frame.
      let pendingJpegBlob = null;
      let pendingT1 = 0;
      let pendingT2 = 0;
      let pendingBrowserRecv = 0;
      let rafScheduled = false;
      let frameCount = 0;

      // jpegImg and objUrl are declared in the outer effect scope so cleanup can access them.

      const scheduleJpegRender = (blob, t1, t2, browserRecv) => {
        pendingJpegBlob = blob; // always keep only the latest
        pendingT1 = t1;
        pendingT2 = t2;
        pendingBrowserRecv = browserRecv;
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          const blobToRender = pendingJpegBlob;
          const snapT1 = pendingT1;
          const snapT2 = pendingT2;
          const snapBrowserRecv = pendingBrowserRecv;
          pendingJpegBlob = null;
          if (!blobToRender || !active) return;

          // Revoke the previous object URL to free memory
          if (objUrl) {
            URL.revokeObjectURL(objUrl);
          }
          objUrl = URL.createObjectURL(blobToRender);
          jpegImg.src = objUrl;

          // img.decode() resolves in the current rendering cycle — much faster
          // than createImageBitmap which schedules a new microtask/tick.
          jpegImg.decode().then(() => {
            if (!active) return;
            const w = jpegImg.naturalWidth;
            const h = jpegImg.naturalHeight;
            if (w && h && (w !== videoWidthRef.current || h !== videoHeightRef.current)) {
              videoWidthRef.current = w;
              videoHeightRef.current = h;
              setVideoWidth(w);
              setVideoHeight(h);
              setRotation(w > h ? 90 : 0);
            }
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
              canvas.getContext('2d').drawImage(jpegImg, 0, 0, w, h);
            }
            setIsPlaying(true);

            const browserDisplay = Date.now();
            frameCount++;
            if (frameCount % 60 === 0 && snapT1 > 0) {
              console.log(
                `[LATENCY] Frame #${frameCount} | Provider Ingress: ${snapT1} | ` +
                `ProvTransit: ${snapT2 - snapT1}ms | Network: ${snapBrowserRecv - snapT2}ms | ` +
                `BrowserRender: ${browserDisplay - snapBrowserRecv}ms | Total: ${browserDisplay - snapT1}ms`
              );
            }
          }).catch((err) => console.warn('img.decode failed:', err));
        });
      };


      ws.onopen = () => {
        if (!active) {
          ws.close();
          return;
        }
        console.log(`WebSocket connected to ${wsUrl}`);
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        if (active) {
          setIsPlaying(false);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        if (active) {
          setErrorMsg('Stream connection lost or failed to connect');
        }
      };

      ws.onmessage = (event) => {
        if (!active) return;
        if (typeof event.data === 'string') {
          if (onWSMessageRef.current) {
            onWSMessageRef.current(event.data);
          }
          return;
        }

        const buf = event.data; // ArrayBuffer
        const header = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));

        // ── iOS raw JPEG path ──────────────────────────────────────────────
        // The backend prefixes every JPEG frame with 4-byte magic 'J','P','E','G'.
        // Feed into the RAF-gated renderer: latest-wins, no async queue buildup.
        if (
          header.length === 4 &&
          header[0] === 0x4A && // 'J'
          header[1] === 0x50 && // 'P'
          header[2] === 0x45 && // 'E'
          header[3] === 0x47    // 'G'
        ) {
          isIOSStreamRef.current = true;
          const browserRecv = Date.now();
          const view = new DataView(buf);
          let t1 = 0;
          let t2 = 0;
          if (buf.byteLength >= 20) {
            try {
              t1 = Number(view.getBigUint64(4, false));
              t2 = Number(view.getBigUint64(12, false));
            } catch (e) {
              console.warn('Failed to parse frame timestamps:', e);
            }
          }
          const jpegBlob = new Blob([buf.slice(20)], { type: 'image/jpeg' });
          scheduleJpegRender(jpegBlob, t1, t2, browserRecv);
          return;
        }

        // ── Android H.264 WebCodecs path ──────────────────────────────────
        const chunk = new Uint8Array(buf);

        if (!decoder || decoder.state === 'closed') {
          return;
        }

        try {
          const { hasIDR, isConfigOnly, nals } = processAnnexB(chunk);
          
          if (savedSPS) {
            const skip = (savedSPS[2] === 1) ? 3 : 4;
            const profileIdc = savedSPS[skip + 1];
            const constraints = savedSPS[skip + 2];
            const levelIdc = savedSPS[skip + 3];
            const codecStr = `avc1.${profileIdc.toString(16).padStart(2, '0')}${constraints.toString(16).padStart(2, '0')}${levelIdc.toString(16).padStart(2, '0')}`;
            if (codecStr !== currentCodec) {
              console.log(`Configuring VideoDecoder with codec: ${codecStr}`);
              decoder.configure({
                codec: codecStr,
                optimizeForLatency: true
              });
              currentCodec = codecStr;
            }
          }

          if (isConfigOnly) {
            return;
          }

          let dataToDecode = chunk;
          if (hasIDR) {
            const alreadyHasSPS = nals.some(nal => {
              if (nal.header >= chunk.length) return false;
              return (chunk[nal.header] & 0x1f) === 7;
            });
            if (!alreadyHasSPS && savedSPS && savedPPS) {
              const combined = new Uint8Array(savedSPS.length + savedPPS.length + chunk.length);
              combined.set(savedSPS, 0);
              combined.set(savedPPS, savedSPS.length);
              combined.set(chunk, savedSPS.length + savedPPS.length);
              dataToDecode = combined;
            }
          }

          if (decoder.decodeQueueSize > 2 && !hasIDR) {
            // Drop lagging delta frame if browser queue is backed up; next keyframe will resync
            return;
          }

          const timestamp = Math.floor(performance.now() * 1000);
          const encodedChunk = new EncodedVideoChunk({
            type: hasIDR ? 'key' : 'delta',
            timestamp: timestamp,
            data: dataToDecode
          });
          decoder.decode(encodedChunk);
        } catch (err) {
          console.error('Decode failed:', err);
        }
      };
    };

    startWebSocket();

    return () => {
      active = false;
      if (ws) {
        ws.close();
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.close();
        } catch (e) {
          console.warn('Error closing decoder:', e);
        }
      }
      // Clean up any outstanding object URL from the JPEG renderer
      if (objUrl) {
        URL.revokeObjectURL(objUrl);
        objUrl = null;
      }
    };
  }, [wsUrl]);



  // ── Layout & aspect ratio ───────────────────────────────────────────────────

  const isLandscape = rotation === 90 || rotation === 270;

  let currentAspectRatio = initial.ratio;
  if (videoWidth && videoHeight) {
    currentAspectRatio = `${videoWidth} / ${videoHeight}`;
  } else if (isLandscape) {
    const parts = initial.ratio.split('/');
    if (parts.length === 2) currentAspectRatio = `${parts[1].trim()} / ${parts[0].trim()}`;
  }

  const screenStyle = isLandscape
    ? { width: '100%', maxWidth: '880px', height: '62vh', maxHeight: '640px', aspectRatio: currentAspectRatio }
    : { height: '82vh', maxHeight: '880px', aspectRatio: currentAspectRatio };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleRunShell = async () => {
    if (!shellCmd.trim()) return;
    const cmd = shellCmd.trim();
    setShellExecuting(true);
    setShellOutput(prev => prev + `\n$ ${cmd}\n`);
    try {
      const res = await execShell(cmd);
      if (res && res.output) {
        setShellOutput(prev => prev + res.output + '\n');
      } else if (res && res.message) {
        setShellOutput(prev => prev + res.message + '\n');
      } else {
        setShellOutput(prev => prev + '[Command executed successfully]\n');
      }
    } catch (e) {
      setShellOutput(prev => prev + `Error: ${e.message}\n`);
    } finally {
      setShellExecuting(false);
      setShellCmd('');
    }
  };

  const handleOpenUrl = () => {
    if (!navUrl.trim()) return;
    let url = navUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    execShell(`am start -a android.intent.action.VIEW -d "${url}"`);
  };

  const appShortcuts = [
    { label: 'Settings', icon: Settings, color: '#94a3b8', command: 'am start -a android.settings.SETTINGS' },
    { label: 'Chrome', icon: Globe, color: '#38bdf8', command: 'am start -n com.android.chrome/com.google.android.apps.chrome.Main' },
    { label: 'WiFi', icon: Wifi, color: '#a78bfa', command: 'am start -a android.settings.WIFI_SETTINGS' },
    { label: 'Language', icon: Globe, color: '#22c55e', command: 'am start -a android.settings.LOCALE_SETTINGS' },
    { label: 'Manage Apps', icon: Package, color: '#fb923c', command: 'am start -a android.settings.MANAGE_APPLICATIONS_SETTINGS' },
    { label: 'Developer', icon: Code, color: '#f87171', command: 'am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS' },
    { label: 'Reboot Device', icon: Power, color: '#ef4444', command: 'am broadcast -a android.intent.action.REBOOT' },
  ];

  if (device.model === 'Loading...') {
    return (
      <div className="device-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh', gap: '1.5rem' }}>
        <span className="spinner"></span>
        <div style={{ color: 'var(--color-fg-muted)', fontSize: '14px' }}>Connecting to device session...</div>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="device-page">
      {/* ── TOP WINDOW HEADER (matching Image 2) ── */}
      <div className="stream-window-bar">
        <div className="stream-bar-left">
          <button className="stream-back-btn" onClick={onBack} title="Back to Devices">
            <ChevronLeft size={16} /> Devices
          </button>
          <div className="stream-title-badge">
            <span className="stream-title-text">Stream {device.serial}</span>
            <span className="stream-model-sub">({device.manufacturer} {device.model})</span>
          </div>
        </div>

        <div className="stream-bar-center">
          {/* Zoom In / Zoom Out Controls */}
          <div className="zoom-control-pill">
            <button
              className="zoom-btn"
              onClick={() => setZoom(z => Math.max(0.5, +(z - 0.15).toFixed(2)))}
              title="Zoom Out (-)"
            >
              -
            </button>
            <span
              className="zoom-label-btn"
              onClick={() => setZoom(1.0)}
              title="Click to reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="zoom-btn"
              onClick={() => setZoom(z => Math.min(2.0, +(z + 0.15).toFixed(2)))}
              title="Zoom In (+)"
            >
              +
            </button>
            <button
              className="zoom-btn-fit"
              onClick={() => setZoom(0.85)}
              title="Fit to Window"
            >
              Fit
            </button>
          </div>
        </div>

        <div className="stream-bar-right">
          <div className="live-fps-badge">
            <span className="live-dot-pulse" />
            LIVE 60 FPS
          </div>
          <button
            className="stream-action-icon-btn"
            onClick={() => { if (wsRef.current) wsRef.current.close(); }}
            title="Reload Stream"
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="stream-action-icon-btn"
            onClick={() => setRotation(r => r === 0 ? 90 : 0)}
            title="Rotate Screen"
          >
            <RotateCw size={15} />
          </button>
          <button
            className="stream-action-icon-btn"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
          >
            <Maximize size={15} />
          </button>
        </div>
      </div>

      {/* ── CENTERED STREAM VIEWPORT & DOCKED SIDE CONTROLS ── */}
      <div className="stream-centered-container">
        <div
          className="phone-dock-assembly"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        >
          {/* Centered Phone Frame */}
          <div className={`phone-mockup-centered ${isLandscape ? 'landscape' : ''}`}>
            <div className="phone-screen" style={screenStyle}>
              {errorMsg && (
                <div className="phone-placeholder error">
                  <AlertTriangle size={28} />
                  <div className="phone-placeholder-message">{errorMsg}</div>
                </div>
              )}
              {!errorMsg && !isPlaying && (
                <div className="phone-placeholder">
                  <span className="spinner"></span>
                  <div style={{ marginTop: '14px', fontSize: '13px' }}>Connecting to live stream...</div>
                </div>
              )}
              <canvas
                ref={canvasRef}
                tabIndex={0}
                className="phone-video"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onWheel={handleWheel}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
                style={{
                  width: '100%',
                  height: '100%',
                  cursor: 'crosshair',
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              />
              {touchIndicator && (
                <div
                  key={touchIndicator.id}
                  className="touch-ripple"
                  style={{
                    left: `${touchIndicator.x}%`,
                    top: `${touchIndicator.y}%`,
                  }}
                />
              )}
              <div
                id="highlight-overlay"
                style={{
                  display: 'none',
                  position: 'absolute',
                  border: '2px solid var(--accent)',
                  backgroundColor: 'rgba(37, 99, 235, 0.3)',
                  pointerEvents: 'none',
                  zIndex: 20
                }}
              />
            </div>
          </div>

          {/* Docked Vertical Side Controls Bar (matching Image 2) */}
          <div className="docked-controls-sidebar">
            <button
              className={`dock-btn ${activeSideDrawer === 'more' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'more' ? null : 'more')}
              title="Device Info & Options"
            >
              <MoreVertical size={18} />
            </button>
            <button
              className="dock-btn power"
              onClick={() => sendControlKey(26)}
              title="Power / Sleep / Wake"
            >
              <Power size={18} />
            </button>
            <button
              className="dock-btn"
              onClick={() => setRotation(r => r === 0 ? 90 : 0)}
              title="Rotate Screen"
            >
              <RotateCw size={18} />
            </button>

            <div className="dock-separator" />

            <button className="dock-btn" onClick={() => sendControlKey(3)} title="Home">
              <Circle size={18} />
            </button>
            <button className="dock-btn" onClick={() => sendControlKey(4)} title="Back">
              <ChevronLeft size={20} />
            </button>
            <button className="dock-btn" onClick={() => sendControlKey(187)} title="Recents / App Switcher">
              <Square size={17} />
            </button>

            <div className="dock-separator" />

            <button className="dock-btn" onClick={takeScreenshot} title="Capture Screenshot">
              <Camera size={18} />
            </button>
            <button
              className={`dock-btn ${activeSideDrawer === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'upload' ? null : 'upload')}
              title="Install APK & Upload Files"
            >
              <FolderUp size={18} />
            </button>
            <button
              className={`dock-btn ${activeSideDrawer === 'shell' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'shell' ? null : 'shell')}
              title="ADB Shell Terminal"
            >
              <Terminal size={18} />
            </button>
            <button
              className={`dock-btn ${activeSideDrawer === 'nav' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'nav' ? null : 'nav')}
              title="Open URL / Web Browser"
            >
              <Compass size={18} />
            </button>
            <button
              className={`dock-btn ${activeSideDrawer === 'apps' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'apps' ? null : 'apps')}
              title="Quick Apps & System Settings"
            >
              <Settings size={18} />
            </button>
            <button
              className={`dock-btn ${activeSideDrawer === 'files' ? 'active' : ''}`}
              onClick={() => setActiveSideDrawer(d => d === 'files' ? null : 'files')}
              title="Device File Manager"
            >
              <Folder size={18} />
            </button>

            <div className="dock-separator" />

            {/* Volume Control Group with Vertical Indicator (matching Image 2) */}
            <div className="dock-volume-group">
              <button
                className="dock-vol-btn"
                onClick={() => {
                  sendControlKey(24);
                  setVolumeLevel(v => Math.min(100, v + 10));
                }}
                title="Volume Up"
              >
                +
              </button>
              <div
                className="dock-vol-track"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(100, Math.round((1 - (e.clientY - rect.top) / rect.height) * 100)));
                  setVolumeLevel(pct);
                  sendControlKey(pct > volumeLevel ? 24 : 25);
                }}
                title={`Volume: ${volumeLevel}%`}
              >
                <div className="dock-vol-fill" style={{ height: `${volumeLevel}%` }} />
              </div>
              <button
                className="dock-vol-btn"
                onClick={() => {
                  sendControlKey(25);
                  setVolumeLevel(v => Math.max(0, v - 10));
                }}
                title="Volume Down"
              >
                -
              </button>
            </div>
          </div>
        </div>

        {/* ── SLIDE-OUT DRAWER PANEL FOR DASHBOARD FUNCTIONS ── */}
        {activeSideDrawer && (
          <div className="slideout-drawer-panel">
            <div className="drawer-header">
              <div className="drawer-title">
                {activeSideDrawer === 'upload' && <><FolderUp size={18} /> Install APK & Upload</>}
                {activeSideDrawer === 'shell' && <><Terminal size={18} /> ADB Shell Console</>}
                {activeSideDrawer === 'nav' && <><Compass size={18} /> Browser Navigation</>}
                {activeSideDrawer === 'apps' && <><Settings size={18} /> Apps & System Controls</>}
                {activeSideDrawer === 'files' && <><Folder size={18} /> File Explorer</>}
                {activeSideDrawer === 'more' && <><MoreVertical size={18} /> Device Information</>}
              </div>
              <button
                className="drawer-close-btn"
                onClick={() => setActiveSideDrawer(null)}
                title="Close Drawer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="drawer-body">
              {/* Upload Drawer */}
              {activeSideDrawer === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Install Android packages (.apk) or push files directly to storage.
                  </div>
                  {uploadProgress.active ? (
                    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>
                        <span>{uploadProgress.message}</span>
                        <span>{uploadProgress.percent}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${uploadProgress.percent}%`, background: '#3b82f6', transition: 'width 0.2s' }} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="dropzone"
                        onClick={() => handleDropzoneClick('app')}
                        onDrop={(e) => handleDrop(e, 'app')}
                        onDragOver={handleDragOver}
                        style={{ padding: '24px 16px', border: '2px dashed rgba(59, 130, 246, 0.4)', borderRadius: '16px', background: 'rgba(59, 130, 246, 0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#e2e8f0' }}
                      >
                        <FolderUp size={28} color="#3b82f6" />
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>Click or drop APK to install</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Supports .apk files</span>
                      </button>

                      <button
                        type="button"
                        className="dropzone"
                        onClick={() => handleDropzoneClick('file')}
                        onDrop={(e) => handleDrop(e, 'file')}
                        onDragOver={handleDragOver}
                        style={{ padding: '24px 16px', border: '2px dashed rgba(34, 197, 94, 0.4)', borderRadius: '16px', background: 'rgba(34, 197, 94, 0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#e2e8f0' }}
                      >
                        <Folder size={28} color="#22c55e" />
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>Click or drop file to push</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Pushes to /sdcard/Download</span>
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Shell Drawer */}
              {activeSideDrawer === 'shell' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. pm list packages -3"
                      value={shellCmd}
                      onChange={(e) => setShellCmd(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRunShell()}
                      style={{ flex: 1, padding: '10px 14px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#fff', fontFamily: 'monospace', fontSize: '13px' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleRunShell}
                      disabled={shellExecuting}
                      style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Play size={14} /> Run
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {['ls -la /sdcard', 'pm list packages -3', 'dumpsys battery', 'ip addr', 'top -n 1'].map(cmd => (
                      <button
                        key={cmd}
                        onClick={() => { setShellCmd(cmd); }}
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace' }}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Terminal Output</span>
                    <button
                      onClick={() => setShellOutput('')}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  </div>

                  <pre style={{ height: '320px', background: '#05070d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px', overflow: 'auto', color: '#4ade80', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                    {shellOutput || '# Terminal ready. Enter a shell command above.\n'}
                  </pre>
                </div>
              )}

              {/* Navigation Drawer */}
              {activeSideDrawer === 'nav' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    Launch any web address in the device's default browser or Chrome.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="https://example.com"
                      value={navUrl}
                      onChange={(e) => setNavUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleOpenUrl()}
                      style={{ flex: 1, padding: '10px 14px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#fff', fontSize: '13px' }}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleOpenUrl}
                      style={{ padding: '0 16px' }}
                    >
                      Open
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Quick Bookmarks</span>
                    {['https://google.com', 'https://youtube.com', 'https://fast.com', 'https://github.com'].map(url => (
                      <button
                        key={url}
                        onClick={() => { setNavUrl(url); execShell(`am start -a android.intent.action.VIEW -d "${url}"`); }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', color: '#cbd5e1', fontSize: '13px', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span>{url.replace('https://', '')}</span>
                        <ChevronLeft size={16} style={{ transform: 'rotate(180deg)', opacity: 0.6 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Apps & System Drawer */}
              {activeSideDrawer === 'apps' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    One-click launch system screens and diagnostic utilities.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                    {appShortcuts.map(app => {
                      const Icon = app.icon;
                      return (
                        <button
                          key={app.label}
                          onClick={() => execShell(app.command)}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', color: '#e2e8f0', cursor: 'pointer', transition: 'all 0.2s' }}
                        >
                          <Icon size={24} color={app.color} />
                          <span style={{ fontSize: '12px', fontWeight: 600 }}>{app.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Files Drawer */}
              {activeSideDrawer === 'files' && (
                <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                  <FilesTab device={device} onFolderClick={handleFolderClick} onBackClick={handleBackClick} />
                </div>
              )}

              {/* Info & More Drawer */}
              {activeSideDrawer === 'more' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Manufacturer</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{device.manufacturer || 'Android'}</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Model</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{device.model}</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Android Version</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Android {device.os_version || '14'}</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Battery</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e' }}>{device.battery || 100}%</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>Stream Port</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8' }}>{streamPort || 'Direct'}</div>
                    </div>
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>IP Address</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{device.ip || '127.0.0.1'}</div>
                    </div>
                  </div>

                  <button
                    className="btn btn-danger"
                    onClick={() => onRelease(device.serial)}
                    style={{ marginTop: '16px', padding: '12px', width: '100%', borderRadius: '12px', fontWeight: 600 }}
                  >
                    Release Device Session
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DevicePage;

