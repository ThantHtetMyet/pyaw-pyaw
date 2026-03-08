import mqtt from 'mqtt';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapComponent from './components/MapComponent/MapComponent';
import MenuButton from './components/MenuButton/MenuButton';
import InfoModal from './components/InfoModal/InfoModal';

const DEFAULT_SESSION_MS = 5 * 60 * 1000;
const DEFAULT_API_BASE_URL = 'https://pyaw-pyaw-api.onrender.com';
const CLIENT_ID_KEY = 'pyaw-pyaw-client-id';
const MIN_SCAN_VISIBILITY_MS = 5 * 1000;
const ROOM_ACTIVITY_EVENT_KEY = 'pyaw-pyaw-room-activity-event';
const HIDDEN_TOPICS_KEY = 'pyaw-pyaw-hidden-topics';
const KICKED_TOPICS_KEY = 'pyaw-pyaw-kicked-topics';
const VIDEO_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function normalizeBaseUrl(urlText) {
  return (urlText || '').trim().replace(/\/+$/, '');
}

function resolveApiBaseUrl() {
  const configured = normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL);
  if (configured) {
    return configured;
  }
  return DEFAULT_API_BASE_URL;
}

const apiBaseUrl = resolveApiBaseUrl();

async function requestJson(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const payload = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }

  return payload;
}

function parseExpiresAt(value) {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
    }
  }
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_SESSION_MS;
}

function isFutureTimestamp(value) {
  return Number.isFinite(value) && value > Date.now();
}

function getOrCreateClientId() {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const nextId = `web-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(CLIENT_ID_KEY, nextId);
  return nextId;
}

function createMqttConnectionId(baseClientId, role) {
  const normalizedBase = typeof baseClientId === 'string' && baseClientId.trim()
    ? baseClientId.trim()
    : `web-${Math.random().toString(36).slice(2, 10)}`;
  const normalizedRole = role === 'host' ? 'host' : 'guest';
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${normalizedBase}-${normalizedRole}-${randomSuffix}`;
}

function buildHostIdPayload(hostId, roomData) {
  if (!hostId) {
    return hostId;
  }
  const metadata = {
    lat: roomData?.lat,
    lng: roomData?.lng,
    gender: roomData?.gender === 'Female' ? 'Female' : 'Male',
    username: roomData?.username || '',
    messageType: roomData?.messageType || 'Hi',
    countryCode: normalizeCountryCode(roomData?.countryCode),
    countryName: typeof roomData?.countryName === 'string' ? roomData.countryName.trim() : '',
  };
  if (!Number.isFinite(metadata.lat) || !Number.isFinite(metadata.lng)) {
    return hostId;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  const encoded = window.btoa(String.fromCharCode(...bytes));
  return `${hostId}::meta::${encoded}`;
}

function readHostIdPayload(hostId) {
  if (typeof hostId !== 'string') {
    return null;
  }
  const [, encoded] = hostId.split('::meta::');
  if (!encoded) {
    return null;
  }
  try {
    const binary = window.atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(decoded);
    if (!Number.isFinite(parsed?.lat) || !Number.isFinite(parsed?.lng)) {
      return null;
    }
    return {
      lat: parsed.lat,
      lng: parsed.lng,
      gender: parsed.gender === 'Female' ? 'Female' : 'Male',
      username: typeof parsed.username === 'string' ? parsed.username : '',
      messageType: parsed.messageType || 'Hi',
      countryCode: normalizeCountryCode(parsed.countryCode),
      countryName: typeof parsed.countryName === 'string' ? parsed.countryName.trim() : '',
    };
  } catch (error) {
    return null;
  }
}

function getStoredHostRoomTopic() {
  try {
    const raw = window.localStorage.getItem('pyaw-pyaw-active-room');
    if (!raw) {
      return '';
    }
    const stored = JSON.parse(raw);
    if (!stored || stored.role !== 'host') {
      return '';
    }
    if (!Number.isFinite(stored.sessionExpiresAt) || stored.sessionExpiresAt <= Date.now()) {
      window.localStorage.removeItem('pyaw-pyaw-active-room');
      return '';
    }
    return typeof stored.topic === 'string' ? stored.topic : '';
  } catch {
    return '';
  }
}

function emitRoomActivityEvent(eventData) {
  window.localStorage.setItem(
    ROOM_ACTIVITY_EVENT_KEY,
    JSON.stringify({
      ...eventData,
      updatedAt: Date.now(),
    })
  );
}

function readHiddenTopics() {
  try {
    const raw = window.localStorage.getItem(HIDDEN_TOPICS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(topic => typeof topic === 'string' && topic.trim());
  } catch {
    return [];
  }
}

function writeHiddenTopics(topics) {
  window.localStorage.setItem(HIDDEN_TOPICS_KEY, JSON.stringify(Array.from(topics)));
}

function readKickedTopics() {
  try {
    const raw = window.localStorage.getItem(KICKED_TOPICS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(topic => typeof topic === 'string' && topic.trim());
  } catch {
    return [];
  }
}

function writeKickedTopics(topics) {
  window.localStorage.setItem(KICKED_TOPICS_KEY, JSON.stringify(Array.from(topics)));
}

function normalizeCountryCode(countryCode) {
  if (typeof countryCode !== 'string') {
    return '';
  }
  const normalized = countryCode.trim().toUpperCase();
  return normalized.length === 2 ? normalized : '';
}

function getCountryName(countryCode) {
  const normalizedCode = normalizeCountryCode(countryCode);
  if (!normalizedCode) {
    return '';
  }
  try {
    const formatter = new Intl.DisplayNames(['en'], { type: 'region' });
    return formatter.of(normalizedCode) || normalizedCode;
  } catch {
    return normalizedCode;
  }
}

function stopMediaTracks(stream) {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach(track => {
    track.stop();
  });
}

function getCountryFlagSource(countryCode) {
  const normalizedCode = normalizeCountryCode(countryCode);
  if (!normalizedCode) {
    return '';
  }
  return `https://flagcdn.com/24x18/${normalizedCode.toLowerCase()}.png`;
}

async function resolveCountryByCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { countryCode: '', countryName: '' };
  }
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=3&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
        },
      }
    );
    if (!response.ok) {
      return { countryCode: '', countryName: '' };
    }
    const data = await response.json();
    const countryCode = normalizeCountryCode(data?.address?.country_code);
    const countryName = typeof data?.address?.country === 'string' ? data.address.country.trim() : '';
    return {
      countryCode,
      countryName: countryName || getCountryName(countryCode),
    };
  } catch {
    return { countryCode: '', countryName: '' };
  }
}

function RoomTab({ topic, role, sessionExpiresAt, username, onExit, onSessionExpiresAtChange }) {
  const [isPeerJoined, setIsPeerJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [showChatInterface, setShowChatInterface] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const [isKickoutModalOpen, setIsKickoutModalOpen] = useState(false);
  const [isExtendSessionModalOpen, setIsExtendSessionModalOpen] = useState(false);
  const [isExtendingSession, setIsExtendingSession] = useState(false);
  const [isKickingOut, setIsKickingOut] = useState(false);
  const [transportError, setTransportError] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [isRoomKilled, setIsRoomKilled] = useState(false);
  const [currentSessionExpiresAt, setCurrentSessionExpiresAt] = useState(sessionExpiresAt);
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000))
  );
  const [joinNotice, setJoinNotice] = useState('');
  const [peerName, setPeerName] = useState('');
  const [peerCountry, setPeerCountry] = useState('');
  const [selfCountry, setSelfCountry] = useState('');
  const [isVideoRequestModalOpen, setIsVideoRequestModalOpen] = useState(false);
  const [videoRequestSenderRole, setVideoRequestSenderRole] = useState('guest');
  const [videoRequestSenderName, setVideoRequestSenderName] = useState('');
  const [isVideoRequestPending, setIsVideoRequestPending] = useState(false);
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [localMediaStream, setLocalMediaStream] = useState(null);
  const [remoteMediaStream, setRemoteMediaStream] = useState(null);
  const mqttClientRef = useRef(null);
  const clientIdRef = useRef(getOrCreateClientId());
  const mqttConnectionIdRef = useRef(createMqttConnectionId(clientIdRef.current, role));
  const hasSeenPeerRef = useRef(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const composeTextareaRef = useRef(null);
  const joinNoticeTimerRef = useRef(null);
  const headerRef = useRef(null);
  const hasHandledKickoutRef = useRef(false);
  const hasConfirmedGuestOwnershipRef = useRef(false);
  const guestMismatchCountRef = useRef(0);
  const currentSessionExpiresAtRef = useRef(sessionExpiresAt);
  const promptedExpiresAtRef = useRef(0);
  const hasHandledExpiredExitRef = useRef(false);
  const expireExitTimerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const isExpired = remainingSeconds <= 0;
  const isChatLocked = isExpired || isRoomKilled;
  const isHostRole = role === 'host';

  const notifyMapAndClose = useCallback(payload => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          {
            type: 'pyaw-pyaw-room-exit',
            ...payload,
          },
          window.location.origin
        );
      }
    } catch {
    }
    if (window.opener && !window.opener.closed) {
      window.close();
      window.setTimeout(() => {
        if (!window.closed) {
          window.location.href = window.location.pathname;
        }
      }, 120);
      return;
    }
    window.location.href = window.location.pathname;
  }, []);

  const applySessionExpiryUpdate = useCallback(
    nextExpiresAt => {
      const parsedExpiresAt = parseExpiresAt(nextExpiresAt);
      if (!Number.isFinite(parsedExpiresAt) || parsedExpiresAt <= Date.now()) {
        return;
      }
      hasHandledExpiredExitRef.current = false;
      setCurrentSessionExpiresAt(parsedExpiresAt);
      setRemainingSeconds(Math.max(0, Math.ceil((parsedExpiresAt - Date.now()) / 1000)));
      promptedExpiresAtRef.current = 0;
      if (typeof onSessionExpiresAtChange === 'function') {
        onSessionExpiresAtChange({
          topic,
          role,
          username,
          sessionExpiresAt: parsedExpiresAt,
        });
      }
    },
    [onSessionExpiresAtChange, role, topic, username]
  );

  const addMessage = (sender, text, options = {}) => {
    if (!text) {
      return;
    }
    const messageType = options.type || 'chat';
    const isOwn = Boolean(options.isOwn);
    setMessages(prev => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        sender,
        text,
        type: messageType,
        isOwn,
      },
    ]);
  };

  const publishVideoSignal = useCallback(
    payload => {
      if (!payload || typeof payload !== 'object') {
        return;
      }
      const client = mqttClientRef.current;
      if (!client?.connected) {
        return;
      }
      client.publish(
        `${topic}/chat`,
        JSON.stringify({
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          senderCountry: selfCountry,
          ...payload,
        })
      );
    },
    [role, selfCountry, topic, username]
  );

  const closePeerConnection = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection) {
      return;
    }
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnectionRef.current = null;
  }, []);

  const resetVideoCallState = useCallback(() => {
    closePeerConnection();
    stopMediaTracks(localStreamRef.current);
    stopMediaTracks(remoteStreamRef.current);
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalMediaStream(null);
    setRemoteMediaStream(null);
    setIsVideoCallActive(false);
    setIsVideoRequestPending(false);
    setIsVideoRequestModalOpen(false);
  }, [closePeerConnection]);

  const handleEndVideoCall = useCallback(
    shouldNotifyPeer => {
      if (shouldNotifyPeer) {
        publishVideoSignal({ type: 'video-end' });
      }
      resetVideoCallState();
    },
    [publishVideoSignal, resetVideoCallState]
  );

  const ensureLocalMediaStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Video call is not supported in this browser.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    setLocalMediaStream(stream);
    return stream;
  }, []);

  const ensurePeerConnection = useCallback(async () => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }
    const peerConnection = new RTCPeerConnection({ iceServers: VIDEO_ICE_SERVERS });
    peerConnection.onicecandidate = event => {
      if (!event.candidate) {
        return;
      }
      publishVideoSignal({
        type: 'webrtc-ice',
        candidate: event.candidate,
      });
    };
    peerConnection.ontrack = event => {
      const [stream] = event.streams || [];
      if (!stream) {
        return;
      }
      remoteStreamRef.current = stream;
      setRemoteMediaStream(stream);
    };
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        resetVideoCallState();
      }
    };
    const stream = await ensureLocalMediaStream();
    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });
    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }, [ensureLocalMediaStream, publishVideoSignal, resetVideoCallState]);

  const handleStartVideoOffer = useCallback(async () => {
    try {
      setTransportError('');
      setIsVideoCallActive(true);
      const peerConnection = await ensurePeerConnection();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      publishVideoSignal({
        type: 'webrtc-offer',
        sdp: offer,
      });
      addMessage('System', 'Video call started.', { type: 'system' });
    } catch (error) {
      resetVideoCallState();
      setTransportError(error.message || 'Unable to start video call.');
    }
  }, [ensurePeerConnection, publishVideoSignal, resetVideoCallState]);

  const handleIncomingVideoOffer = useCallback(
    async payload => {
      if (!payload?.sdp) {
        return;
      }
      try {
        setTransportError('');
        setIsVideoCallActive(true);
        const peerConnection = await ensurePeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        publishVideoSignal({
          type: 'webrtc-answer',
          sdp: answer,
        });
      } catch (error) {
        resetVideoCallState();
        setTransportError(error.message || 'Unable to connect video call.');
      }
    },
    [ensurePeerConnection, publishVideoSignal, resetVideoCallState]
  );

  const handleIncomingVideoAnswer = useCallback(
    async payload => {
      if (!payload?.sdp) {
        return;
      }
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
        return;
      }
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } catch (error) {
        resetVideoCallState();
        setTransportError(error.message || 'Unable to finalize video call.');
      }
    },
    [resetVideoCallState]
  );

  const handleIncomingVideoIceCandidate = useCallback(async payload => {
    const candidate = payload?.candidate;
    const peerConnection = peerConnectionRef.current;
    if (!candidate || !peerConnection) {
      return;
    }
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
    }
  }, []);

  const scrollToBottom = (behavior = 'smooth') => {
    const messagesContainer = messagesContainerRef.current;
    if (messagesContainer) {
      if (behavior === 'smooth') {
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
      } else {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, showChatInterface]);

  useEffect(() => {
    setCurrentSessionExpiresAt(sessionExpiresAt);
    currentSessionExpiresAtRef.current = sessionExpiresAt;
    setRemainingSeconds(Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000)));
    hasHandledExpiredExitRef.current = false;
    promptedExpiresAtRef.current = 0;
  }, [sessionExpiresAt]);

  useEffect(() => {
    currentSessionExpiresAtRef.current = currentSessionExpiresAt;
  }, [currentSessionExpiresAt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((currentSessionExpiresAtRef.current - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (joinNoticeTimerRef.current) {
        window.clearTimeout(joinNoticeTimerRef.current);
      }
    },
    []
  );

  useEffect(
    () => () => {
      resetVideoCallState();
    },
    [resetVideoCallState]
  );

  useEffect(() => {
    if (!localVideoRef.current) {
      return;
    }
    localVideoRef.current.srcObject = localMediaStream || null;
  }, [localMediaStream]);

  useEffect(() => {
    if (!remoteVideoRef.current) {
      return;
    }
    remoteVideoRef.current.srcObject = remoteMediaStream || null;
  }, [remoteMediaStream]);

  useEffect(() => {
    if (!isComposeModalOpen) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      composeTextareaRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isComposeModalOpen]);

  useEffect(() => {
    if (!isHostRole || isExpired || isRoomKilled || isExtendingSession) {
      return;
    }
    if (remainingSeconds !== 10) {
      return;
    }
    if (promptedExpiresAtRef.current === currentSessionExpiresAtRef.current) {
      return;
    }
    promptedExpiresAtRef.current = currentSessionExpiresAtRef.current;
    setIsExtendSessionModalOpen(true);
  }, [currentSessionExpiresAt, isExpired, isExtendingSession, isHostRole, isRoomKilled, remainingSeconds]);

  useEffect(() => {
    if (!isExpired || hasHandledExpiredExitRef.current) {
      if (expireExitTimerRef.current) {
        window.clearTimeout(expireExitTimerRef.current);
        expireExitTimerRef.current = null;
      }
      return;
    }
    if (expireExitTimerRef.current) {
      return;
    }
    expireExitTimerRef.current = window.setTimeout(() => {
      expireExitTimerRef.current = null;
      if (!isExpired || hasHandledExpiredExitRef.current) {
        return;
      }
      hasHandledExpiredExitRef.current = true;
      setIsComposeModalOpen(false);
      setIsKickoutModalOpen(false);
      setIsExtendSessionModalOpen(false);
      setInputValue('');
      const exitPayload = { refreshRooms: true, terminatedByHost: false, topic, role, expired: true };
      if (typeof onExit === 'function') {
        onExit(exitPayload);
        return;
      }
      notifyMapAndClose(exitPayload);
    }, 1500);
  }, [isExpired, notifyMapAndClose, onExit, role, topic]);

  useEffect(
    () => () => {
      if (expireExitTimerRef.current) {
        window.clearTimeout(expireExitTimerRef.current);
        expireExitTimerRef.current = null;
      }
    },
    []
  );

  const isWaiting = !isPeerJoined && !isExpired;
  const updatePeerInfo = useCallback(
    payload => {
      const senderName = typeof payload?.senderName === 'string' ? payload.senderName.trim() : '';
      const senderCountry = typeof payload?.senderCountry === 'string' ? payload.senderCountry.trim().toUpperCase() : '';
      if (isHostRole && payload?.senderRole === 'guest') {
        if (senderName) {
          setPeerName(senderName);
        }
        if (senderCountry) {
          setPeerCountry(senderCountry);
        }
      }
      if (!isHostRole && payload?.senderRole === 'host') {
        if (senderName) {
          setPeerName(senderName);
        }
        if (senderCountry) {
          setPeerCountry(senderCountry);
        }
      }
    },
    [isHostRole]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      return undefined;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async position => {
        if (cancelled) {
          return;
        }
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=3&addressdetails=1`,
            {
              headers: {
                'Accept-Language': 'en',
              },
            }
          );
          if (!response.ok) {
            return;
          }
          const data = await response.json();
          const countryCode = typeof data?.address?.country_code === 'string'
            ? data.address.country_code.trim().toUpperCase()
            : '';
          if (!cancelled && countryCode) {
            setSelfCountry(countryCode);
          }
        } catch {
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selfCountry || !mqttClientRef.current?.connected) {
      return;
    }
    mqttClientRef.current.publish(
      `${topic}/presence`,
      JSON.stringify({
        type: 'update',
        clientId: clientIdRef.current,
        senderId: clientIdRef.current,
        senderRole: role,
        senderName: username,
        senderCountry: selfCountry,
      })
    );
  }, [selfCountry, topic, role, username]);

  useEffect(() => {
    if (!isWaiting && !isExpired && !showChatInterface) {
      setShowChatInterface(true);
    }
  }, [isWaiting, isExpired, showChatInterface]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeaderHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight || 0;
      document.documentElement.style.setProperty('--room-header-height', `${headerHeight}px`);
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined' && headerRef.current
      ? new ResizeObserver(() => updateHeaderHeight())
      : null;
    resizeObserver?.observe(headerRef.current);
    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    viewport?.addEventListener('resize', updateHeaderHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
      viewport?.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);


  useEffect(() => {
    if (!isHostRole) {
      return undefined;
    }
    let isCancelled = false;
    const syncInitialHostPresence = async () => {
      try {
        const response = await requestJson('/api/rooms/active');
        if (isCancelled) {
          return;
        }
        const activeRoom = (response?.rooms || []).find(room => room?.topic === topic);
        if (activeRoom?.lastGuestId) {
          setIsPeerJoined(true);
          setShowChatInterface(true);
        }
      } catch {
      }
    };
    syncInitialHostPresence();
    return () => {
      isCancelled = true;
    };
  }, [isHostRole, topic]);

  useEffect(() => {
    let isUnmounted = false;
    let mqttClient;

    const setupMqtt = async () => {
      try {
        setTransportError('');
        setIsConnecting(true);
        hasSeenPeerRef.current = false;
        const mqttConfig = await requestJson('/api/mqtt/config');
        if (isUnmounted) {
          return;
        }

        const wsUrl = `${mqttConfig.protocol}://${mqttConfig.host}${mqttConfig.path}`;
        const roomChannels = [`${topic}/presence`, `${topic}/chat`];

        mqttClient = mqtt.connect(wsUrl, {
          clientId: mqttConnectionIdRef.current,
          reconnectPeriod: 2000,
          connectTimeout: 10000,
          clean: true,
        });

        mqttClientRef.current = mqttClient;

        mqttClient.on('connect', () => {
          if (isUnmounted) {
            return;
          }
          setTransportError('');
          setIsConnecting(false);
          mqttClient.subscribe(roomChannels, subscribeError => {
            if (subscribeError) {
              setTransportError(subscribeError.message || 'Failed to subscribe room channels.');
              return;
            }
            mqttClient.publish(
              `${topic}/presence`,
              JSON.stringify({
                type: 'join',
                clientId: clientIdRef.current,
                senderId: clientIdRef.current,
                senderRole: role,
                senderName: username,
                senderCountry: selfCountry,
              })
            );
          });
        });

        mqttClient.on('reconnect', () => {
          if (!isUnmounted) {
            setIsConnecting(true);
          }
        });

        mqttClient.on('message', (messageTopic, messageBuffer) => {
          const payloadText = messageBuffer.toString('utf8');
          let payload;
          try {
            payload = JSON.parse(payloadText);
          } catch (error) {
            payload = { text: payloadText };
          }

          const incomingType = typeof payload?.type === 'string' ? payload.type.trim().toLowerCase() : '';
          const incomingExpiresAt = Date.parse(payload?.expiresAt ?? '');
          const isSessionExtendedMessage = (
            incomingType === 'session-extended' ||
            incomingType === 'session_extended' ||
            incomingType === 'extended'
          ) && Number.isFinite(incomingExpiresAt);

          if (isSessionExtendedMessage) {
            applySessionExpiryUpdate(payload?.expiresAt);
            return;
          }

          if (Date.now() >= currentSessionExpiresAtRef.current) {
            return;
          }

          const senderId = payload?.senderId || payload?.clientId;
          const senderRole = payload?.senderRole === 'host' ? 'host' : 'guest';
          if (senderId && senderId === clientIdRef.current && senderRole === role) {
            return;
          }

          if (messageTopic.endsWith('/presence')) {
            const presenceType = payload?.type;
            if (presenceType === 'leave') {
              resetVideoCallState();
              setIsPeerJoined(false);
              hasSeenPeerRef.current = false;
              setJoinNotice('');
              setPeerName('');
              setPeerCountry('');
              if (role === 'host') {
                setShowChatInterface(false);
                setMessages([]);
                setInputValue('');
              }
              return;
            }
            setIsPeerJoined(true);
            setShowChatInterface(true);
            updatePeerInfo(payload);
            if (presenceType === 'join' && isHostRole) {
              const senderName = typeof payload?.senderName === 'string' && payload.senderName.trim()
                ? payload.senderName.trim()
                : 'Guest';
              setJoinNotice(`${senderName} joined the room`);
              if (joinNoticeTimerRef.current) {
                window.clearTimeout(joinNoticeTimerRef.current);
              }
              joinNoticeTimerRef.current = window.setTimeout(() => {
                setJoinNotice('');
              }, 5000);
            }
            if (presenceType === 'join' && !hasSeenPeerRef.current && mqttClient.connected) {
              hasSeenPeerRef.current = true;
              mqttClient.publish(
                `${topic}/presence`,
                JSON.stringify({
                  type: 'join',
                  clientId: clientIdRef.current,
                  senderId: clientIdRef.current,
                  senderRole: role,
                  senderName: username,
                  senderCountry: selfCountry,
                })
              );
            }
            return;
          }

          if (messageTopic.endsWith('/chat')) {
            if (payload?.type === 'video-request') {
              if (isChatLocked || isVideoCallActive) {
                publishVideoSignal({ type: 'video-reject' });
                return;
              }
              setVideoRequestSenderRole(payload?.senderRole === 'host' ? 'host' : 'guest');
              setVideoRequestSenderName(
                typeof payload?.senderName === 'string' && payload.senderName.trim()
                  ? payload.senderName.trim()
                  : payload?.senderRole === 'host'
                    ? 'Host'
                    : 'Client'
              );
              setIsVideoRequestModalOpen(true);
              return;
            }
            if (payload?.type === 'video-accept') {
              if (!isVideoRequestPending) {
                return;
              }
              setIsVideoRequestPending(false);
              setIsVideoCallActive(true);
              void handleStartVideoOffer();
              return;
            }
            if (payload?.type === 'video-reject') {
              setIsVideoRequestPending(false);
              addMessage('System', `${payload?.senderName || 'Peer'} declined video call.`, { type: 'system' });
              return;
            }
            if (payload?.type === 'video-end') {
              resetVideoCallState();
              addMessage('System', 'Video call ended.', { type: 'system' });
              return;
            }
            if (payload?.type === 'webrtc-offer') {
              void handleIncomingVideoOffer(payload);
              return;
            }
            if (payload?.type === 'webrtc-answer') {
              void handleIncomingVideoAnswer(payload);
              return;
            }
            if (payload?.type === 'webrtc-ice') {
              void handleIncomingVideoIceCandidate(payload);
              return;
            }
            if (payload?.type === 'kill') {
              if (!isHostRole) {
                setIsComposeModalOpen(false);
                setInputValue('');
                const exitPayload = { refreshRooms: true, terminatedByHost: true, topic, role };
                if (typeof onExit === 'function') {
                  onExit(exitPayload);
                } else {
                  notifyMapAndClose(exitPayload);
                }
                return;
              }
              setIsRoomKilled(true);
              resetVideoCallState();
              setShowChatInterface(true);
              addMessage('System', payload?.text || 'Host ended this chat.', { type: 'system' });
              return;
            }
            if (payload?.type === 'kickout') {
              if (!isHostRole) {
                if (hasHandledKickoutRef.current) {
                  return;
                }
                hasHandledKickoutRef.current = true;
                setIsComposeModalOpen(false);
                setInputValue('');
                const exitPayload = { refreshRooms: true, terminatedByHost: false, topic, kickedOut: true };
                if (typeof onExit === 'function') {
                  onExit(exitPayload);
                } else {
                  notifyMapAndClose(exitPayload);
                }
              }
              resetVideoCallState();
              return;
            }
            const text = typeof payload?.text === 'string' ? payload.text : payloadText;
            setIsPeerJoined(true);
            setShowChatInterface(true);
            updatePeerInfo(payload);
            const senderName = payload?.senderName || (payload?.senderRole === 'host' ? 'Host' : 'Guest');
            addMessage(senderName, text, { isOwn: false });
          }
        });

        mqttClient.on('error', error => {
          if (!isUnmounted) {
            setTransportError(error.message || 'MQTT connection failed.');
          }
        });
      } catch (error) {
        if (!isUnmounted) {
          setTransportError(error.message || 'Unable to initialize realtime connection.');
          setIsConnecting(false);
        }
      }
    };

    setupMqtt();
    return () => {
      isUnmounted = true;
      if (mqttClient) {
        mqttClient.end(true);
      }
      mqttClientRef.current = null;
    };
  }, [
    applySessionExpiryUpdate,
    handleIncomingVideoAnswer,
    handleIncomingVideoIceCandidate,
    handleIncomingVideoOffer,
    handleStartVideoOffer,
    isChatLocked,
    isHostRole,
    isVideoCallActive,
    isVideoRequestPending,
    notifyMapAndClose,
    onExit,
    publishVideoSignal,
    resetVideoCallState,
    role,
    selfCountry,
    topic,
    updatePeerInfo,
    username,
  ]);

  useEffect(() => {
    if (!isHostRole) {
      return undefined;
    }
    const eventSource = new EventSource(`${apiBaseUrl}/api/rooms/stream`);
    eventSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload?.topic !== topic) {
          return;
        }
        if (payload?.type === 'extended') {
          applySessionExpiryUpdate(payload?.expiresAt);
          return;
        }
        if (payload?.type !== 'availability') {
          return;
        }
        if (payload?.availability === 'idle') {
          resetVideoCallState();
          setIsPeerJoined(false);
          hasSeenPeerRef.current = false;
          setShowChatInterface(false);
          setMessages([]);
          setInputValue('');
        } else if (payload?.availability === 'busy') {
          setIsPeerJoined(true);
          setShowChatInterface(true);
        }
      } catch {
      }
    };
    return () => {
      eventSource.close();
    };
  }, [applySessionExpiryUpdate, isHostRole, resetVideoCallState, topic]);

  const notifyGuestLeaveApi = useCallback(async () => {
    if (isHostRole) {
      return;
    }
    try {
      await requestJson('/api/rooms/leave', {
        method: 'POST',
        body: JSON.stringify({
          topic,
          guestId: clientIdRef.current,
        }),
      });
    } catch {
    }
  }, [isHostRole, topic]);

  const requestKickoutApi = useCallback(async () => {
    const payload = {
      method: 'POST',
      body: JSON.stringify({ topic }),
    };
    try {
      await requestJson('/api/rooms/kick', payload);
      return;
    } catch (error) {
      const errorMessage = typeof error?.message === 'string' ? error.message : '';
      if (!errorMessage.includes('404')) {
        throw error;
      }
    }
    await requestJson('/api/rooms/kickout', payload);
  }, [topic]);

  const publishRoomPayload = useCallback(
    (publishTopic, payloadText) =>
      new Promise(resolve => {
        const client = mqttClientRef.current;
        if (!client?.connected) {
          resolve();
          return;
        }
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        client.publish(publishTopic, payloadText, finish);
        window.setTimeout(finish, 350);
      }),
    []
  );

  const handleExtendSessionConfirm = useCallback(async () => {
    if (!isHostRole || isExtendingSession || isExpired) {
      return;
    }
    setIsExtendingSession(true);
    try {
      const response = await requestJson('/api/rooms/extend', {
        method: 'POST',
        body: JSON.stringify({
          topic,
          extendSeconds: DEFAULT_SESSION_MS / 1000,
        }),
      });
      const expiresAt = response?.room?.expiresAt;
      applySessionExpiryUpdate(expiresAt);
      await publishRoomPayload(
        `${topic}/chat`,
        JSON.stringify({
          type: 'session-extended',
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          senderCountry: selfCountry,
          expiresAt,
        })
      );
      setIsExtendSessionModalOpen(false);
    } catch (error) {
      setTransportError(error.message || 'Unable to extend session.');
    } finally {
      setIsExtendingSession(false);
    }
  }, [
    applySessionExpiryUpdate,
    isExpired,
    isExtendingSession,
    isHostRole,
    publishRoomPayload,
    role,
    selfCountry,
    topic,
    username,
  ]);

  const handleKickoutConfirm = useCallback(async () => {
    if (!isHostRole || isKickingOut) {
      return;
    }
    setIsKickingOut(true);
    try {
      await publishRoomPayload(
        `${topic}/chat`,
        JSON.stringify({
          type: 'kickout',
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          senderCountry: selfCountry,
          text: 'Host kicked out the client.',
        })
      );
      await requestKickoutApi();
      setIsPeerJoined(false);
      hasSeenPeerRef.current = false;
      setShowChatInterface(false);
      setMessages([]);
      setInputValue('');
      setJoinNotice('');
      setPeerName('');
      setPeerCountry('');
      setIsComposeModalOpen(false);
    } catch (error) {
      setTransportError(error.message || 'Unable to kick out client.');
    } finally {
      setIsKickoutModalOpen(false);
      setIsKickingOut(false);
    }
  }, [isHostRole, isKickingOut, publishRoomPayload, requestKickoutApi, role, selfCountry, topic, username]);

  useEffect(() => {
    if (isHostRole) {
      return undefined;
    }
    const handleBeforeUnload = () => {
      const url = `${apiBaseUrl}/api/rooms/leave`;
      const payload = JSON.stringify({
        topic,
        guestId: clientIdRef.current,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
        return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isHostRole, topic]);

  const handleSendMessage = () => {
    const messageText = inputValue.trim();
    if (!messageText || !mqttClientRef.current?.connected || isChatLocked) {
      return false;
    }

    const payload = JSON.stringify({
      type: 'chat',
      senderId: clientIdRef.current,
      senderRole: role,
      senderName: username,
      senderCountry: selfCountry,
      text: messageText,
    });

    mqttClientRef.current.publish(`${topic}/chat`, payload);
    addMessage(username || (role === 'host' ? 'Host' : 'Guest'), messageText, { isOwn: true });
    setInputValue('');
    return true;
  };

  const handleVideoButtonClick = () => {
    if (isChatLocked || isWaiting) {
      return;
    }
    if (isVideoCallActive) {
      handleEndVideoCall(true);
      addMessage('System', 'Video call ended.', { type: 'system' });
      return;
    }
    if (isVideoRequestPending) {
      return;
    }
    setIsVideoRequestPending(true);
    publishVideoSignal({ type: 'video-request' });
    addMessage('System', 'Video call request sent.', { type: 'system' });
  };

  const handleAcceptVideoRequest = async () => {
    try {
      setTransportError('');
      setIsVideoRequestModalOpen(false);
      setIsVideoCallActive(true);
      await ensureLocalMediaStream();
      publishVideoSignal({ type: 'video-accept' });
      addMessage('System', 'Video request accepted.', { type: 'system' });
    } catch (error) {
      publishVideoSignal({ type: 'video-reject' });
      resetVideoCallState();
      setTransportError(error.message || 'Unable to access camera/microphone.');
    }
  };

  const handleRejectVideoRequest = () => {
    setIsVideoRequestModalOpen(false);
    publishVideoSignal({ type: 'video-reject' });
    addMessage('System', 'Video request rejected.', { type: 'system' });
  };

  const openComposeModal = () => {
    setIsComposeModalOpen(true);
    window.requestAnimationFrame(() => {
      composeTextareaRef.current?.focus();
    });
  };

  useEffect(() => {
    if (isHostRole) {
      return undefined;
    }
    let cancelled = false;
    const guestId = clientIdRef.current;
    const checkGuestStillAllowed = async () => {
      if (hasHandledKickoutRef.current) {
        return;
      }
      try {
        const response = await requestJson('/api/rooms/active');
        if (cancelled) {
          return;
        }
        const room = (response?.rooms || []).find(item => item?.topic === topic);
        const activeGuestId = typeof room?.lastGuestId === 'string' ? room.lastGuestId : '';
        if (activeGuestId && activeGuestId === guestId) {
          hasConfirmedGuestOwnershipRef.current = true;
          guestMismatchCountRef.current = 0;
          return;
        }
        if (!room) {
          hasHandledKickoutRef.current = true;
          setIsComposeModalOpen(false);
          setInputValue('');
          const isSessionExpired = Date.now() >= currentSessionExpiresAtRef.current;
          const exitPayload = {
            refreshRooms: true,
            terminatedByHost: !isSessionExpired,
            topic,
            role,
            expired: isSessionExpired,
          };
          if (typeof onExit === 'function') {
            onExit(exitPayload);
          } else {
            notifyMapAndClose(exitPayload);
          }
          return;
        }
        if (!hasConfirmedGuestOwnershipRef.current) {
          return;
        }
        guestMismatchCountRef.current += 1;
        if (guestMismatchCountRef.current < 2) {
          return;
        }
        hasHandledKickoutRef.current = true;
        setIsComposeModalOpen(false);
        setInputValue('');
        const exitPayload = { refreshRooms: true, terminatedByHost: false, topic, role, kickedOut: true };
        if (typeof onExit === 'function') {
          onExit(exitPayload);
        } else {
          notifyMapAndClose(exitPayload);
        }
      } catch {
      }
    };
    checkGuestStillAllowed();
    const timer = window.setInterval(checkGuestStillAllowed, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isHostRole, notifyMapAndClose, onExit, role, topic]);

  const handleExitChat = async () => {
    const isHost = isHostRole;

    if (isHost) {
      await publishRoomPayload(
        `${topic}/chat`,
        JSON.stringify({
          type: 'kill',
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          senderCountry: selfCountry,
          text: 'Host killed this room.',
        })
      );
    } else {
      await publishRoomPayload(
        `${topic}/presence`,
        JSON.stringify({
          type: 'leave',
          clientId: clientIdRef.current,
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          senderCountry: selfCountry,
        })
      );
      await notifyGuestLeaveApi();
    }
    if (isHost) {
      try {
        await requestJson('/api/rooms/terminate', {
          method: 'POST',
          body: JSON.stringify({ topic }),
        });
      } catch {
      }
      window.localStorage.removeItem('pyaw-pyaw-active-room');
      emitRoomActivityEvent({ type: 'terminated', topic });
    }
    resetVideoCallState();
    mqttClientRef.current?.end(true);
    const exitPayload = { refreshRooms: true, terminatedByHost: isHost, topic, role };
    if (typeof onExit === 'function') {
      onExit(exitPayload);
      return;
    }
    notifyMapAndClose(exitPayload);
  };

  const timerMinutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const timerSeconds = String(remainingSeconds % 60).padStart(2, '0');
  const displayName = typeof username === 'string' && username.trim()
    ? username.trim()
    : isHostRole
      ? 'Host'
      : 'Client';
  const senderName = displayName;
  const receiverName = peerName || (isHostRole ? 'Client' : 'Host');
  const senderCountryCode = selfCountry;
  const receiverCountryCode = peerCountry;
  const senderFlagSource = getCountryFlagSource(senderCountryCode);
  const receiverFlagSource = getCountryFlagSource(receiverCountryCode);
  const senderCountryName = getCountryName(senderCountryCode) || 'Unknown country';
  const receiverCountryName = getCountryName(receiverCountryCode) || 'Unknown country';
  const kickoutTargetName = peerName || receiverName || 'Client';
  const hostName = isHostRole ? senderName : receiverName;
  const clientName = isHostRole ? receiverName : senderName;
  const hostCountryName = isHostRole ? senderCountryName : receiverCountryName;
  const clientCountryName = isHostRole ? receiverCountryName : senderCountryName;
  const hostFlagSource = isHostRole ? senderFlagSource : receiverFlagSource;
  const clientFlagSource = isHostRole ? receiverFlagSource : senderFlagSource;
  const isClientJoined = !isHostRole || isPeerJoined;
  const videoRequestRoleLabel = videoRequestSenderRole === 'host' ? 'Host' : 'Client';
  const videoRequestLabel = videoRequestSenderName || videoRequestRoleLabel;
  const isVideoButtonDisabled = isChatLocked || isWaiting || (!isVideoCallActive && !isPeerJoined);
  const showVideoPanel = Boolean(localMediaStream || remoteMediaStream || isVideoCallActive);

  return (
    <div className="room-tab-page">
      {joinNotice && isHostRole && <div className="room-join-notice">{joinNotice}</div>}
      <div className="room-header" ref={headerRef}>
        <div className="room-header-row">
          <div className="room-top-row">
            <div className={`room-timer ${isExpired ? 'expired' : ''}`}>Session Time Left: {timerMinutes}:{timerSeconds}</div>
            <button
              type="button"
              className={`room-action-button room-exit-top ${isHostRole ? 'danger' : ''}`}
              onClick={handleExitChat}
              aria-label={isHostRole ? 'Kill room' : 'Exit chat'}
            >
              <svg viewBox="0 0 24 24" className="room-action-icon" aria-hidden="true">
                <path d="M15 3h-6a2 2 0 0 0-2 2v3h2V5h6v14h-6v-3H7v3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
                <path d="M13.3 8.3l1.4 1.4-1.3 1.3H5v2h8.4l1.3 1.3-1.4 1.4L9.6 12z" />
              </svg>
              {isHostRole ? 'Kill room' : 'Exit'}
            </button>
          </div>
          <div className="room-user-list">
            <div className="room-user-row">
              <span className="room-user-label">Host:</span>
              <div className="room-user-card">
                <div className="room-user-flag-stack">
                  {hostFlagSource ? (
                    <img className="room-user-flag-img" src={hostFlagSource} alt="Host flag" />
                  ) : (
                    <span className="room-user-flag">🏳️</span>
                  )}
                  <span className="room-user-country">{hostCountryName}</span>
                </div>
                <span className="room-user-divider" aria-hidden="true" />
                <span className="room-user-name">{hostName}</span>
              </div>
            </div>
            <div className="room-user-row">
              <span className="room-user-label">Client:</span>
              <div className="room-user-card">
                {isClientJoined ? (
                  <>
                    <div className="room-user-flag-stack">
                      {clientFlagSource ? (
                        <img className="room-user-flag-img" src={clientFlagSource} alt="Client flag" />
                      ) : (
                        <span className="room-user-flag">🏳️</span>
                      )}
                      <span className="room-user-country">{clientCountryName}</span>
                    </div>
                    <span className="room-user-divider" aria-hidden="true" />
                    <span className="room-user-name">{clientName}</span>
                  </>
                ) : (
                  <span className="room-user-empty-field" aria-hidden="true" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="room-body">
        {isExpired && <div className="room-status expired">Session expired. Please create a new room.</div>}
        {isRoomKilled && <div className="room-status expired">Chat ended by host.</div>}
        {isWaiting && (
          <div className="room-waiting">
            <div className="room-waiting-icon">
              <span />
              <span />
              <span />
            </div>
            <div className="room-status">
              {isConnecting
                ? 'Connecting to realtime server...'
                : role === 'host'
                  ? 'Waiting for someone to join this room...'
                  : 'Connecting to host...'}
            </div>
          </div>
        )}
        {!isWaiting && !isExpired && !showChatInterface && (
          <div className="room-waiting">
            <div className="room-waiting-icon">
              <span />
              <span />
              <span />
            </div>
            <div className="room-connected-text">Connected. Start chatting.</div>
          </div>
        )}
        {showChatInterface && (
          <>
            {showVideoPanel && (
              <div className="room-video-panel">
                <div className="room-video-grid">
                  <div className="room-video-tile">
                    <div className="room-video-name">{receiverName}</div>
                    {remoteMediaStream ? (
                      <video className="room-video-element" ref={remoteVideoRef} autoPlay playsInline />
                    ) : (
                      <div className="room-video-placeholder">Waiting for peer video...</div>
                    )}
                  </div>
                  <div className="room-video-tile">
                    <div className="room-video-name">{senderName}</div>
                    {localMediaStream ? (
                      <video className="room-video-element" ref={localVideoRef} autoPlay playsInline muted />
                    ) : (
                      <div className="room-video-placeholder">Waiting for camera...</div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="chat-messages" ref={messagesContainerRef}>
              {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`chat-message-item ${message.type === 'system' ? 'system' : message.isOwn ? 'own' : 'peer'}`}
                >
                  <div className="chat-message-meta">{message.sender}</div>
                  <div className="chat-message-bubble">{message.text}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </>
        )}
      </div>
      {showChatInterface && (
        <div className="room-footer">
          <div className="chat-input-row">
            <button
              type="button"
              className="chat-compose-button"
              onClick={openComposeModal}
              disabled={isChatLocked}
            >
              <span className="compose-placeholder-text">Type a message...</span>
            </button>
            <button
              type="button"
              className={`chat-video-button ${isVideoCallActive ? 'active' : ''}`}
              onClick={handleVideoButtonClick}
              disabled={isVideoButtonDisabled}
              aria-label={isVideoCallActive ? 'End video call' : 'Start video call'}
            >
              <svg viewBox="0 0 24 24" className="chat-video-icon" aria-hidden="true">
                <path d="M15 7.5a2.5 2.5 0 0 0-2.5-2.5h-7A2.5 2.5 0 0 0 3 7.5v9A2.5 2.5 0 0 0 5.5 19h7a2.5 2.5 0 0 0 2.5-2.5V15l4.2 3a1 1 0 0 0 1.6-.8V6.8a1 1 0 0 0-1.6-.8L15 9z" />
              </svg>
            </button>
            {isHostRole && (
              <button
                type="button"
                className="chat-kickout-button"
                onClick={() => setIsKickoutModalOpen(true)}
                disabled={isChatLocked || isWaiting || isKickingOut}
              >
                Kickout
              </button>
            )}
          </div>
        </div>
      )}
      {showChatInterface && isComposeModalOpen && (
        <div className="room-compose-overlay" onClick={() => setIsComposeModalOpen(false)}>
          <div className="room-compose-modal" onClick={event => event.stopPropagation()}>
            <div className="room-compose-header">
              <div className="room-compose-title">Type Message</div>
              <button
                type="button"
                className="room-compose-close"
                aria-label="Close compose modal"
                onClick={() => setIsComposeModalOpen(false)}
              >
                ×
              </button>
            </div>
            <textarea
              ref={composeTextareaRef}
              className="room-compose-textarea"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              placeholder="Type a message..."
              disabled={isChatLocked}
            />
            <div className="room-compose-actions">
              <button
                type="button"
                className="room-compose-cancel"
                onClick={() => setIsComposeModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="room-compose-send"
                onClick={() => {
                  if (handleSendMessage()) {
                    setIsComposeModalOpen(false);
                  }
                }}
                disabled={isChatLocked}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
      {showChatInterface && isHostRole && isExtendSessionModalOpen && (
        <div
          className="room-compose-overlay"
          onClick={() => {
            if (!isExtendingSession) {
              setIsExtendSessionModalOpen(false);
            }
          }}
        >
          <div className="room-confirm-modal" onClick={event => event.stopPropagation()}>
            <div className="room-confirm-title">Session ends in 10 seconds. Extend 5 minutes?</div>
            <div className="room-confirm-actions">
              <button
                type="button"
                className="room-confirm-no"
                onClick={() => setIsExtendSessionModalOpen(false)}
                disabled={isExtendingSession}
              >
                No
              </button>
              <button
                type="button"
                className="room-confirm-yes"
                onClick={handleExtendSessionConfirm}
                disabled={isExtendingSession}
              >
                {isExtendingSession ? 'Extending...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showChatInterface && isKickoutModalOpen && (
        <div className="room-compose-overlay" onClick={() => setIsKickoutModalOpen(false)}>
          <div className="room-confirm-modal" onClick={event => event.stopPropagation()}>
            <div className="room-confirm-title">Kick out {kickoutTargetName}?</div>
            <div className="room-confirm-actions">
              <button
                type="button"
                className="room-confirm-no"
                onClick={() => setIsKickoutModalOpen(false)}
                disabled={isKickingOut}
              >
                No
              </button>
              <button
                type="button"
                className="room-confirm-yes"
                onClick={handleKickoutConfirm}
                disabled={isKickingOut}
              >
                {isKickingOut ? 'Kicking...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showChatInterface && isVideoRequestModalOpen && (
        <div className="room-compose-overlay" onClick={handleRejectVideoRequest}>
          <div className="room-confirm-modal" onClick={event => event.stopPropagation()}>
            <div className="room-confirm-title">{videoRequestLabel} asks you to turn on video call.</div>
            <div className="room-confirm-actions">
              <button
                type="button"
                className="room-confirm-no"
                onClick={handleRejectVideoRequest}
              >
                No
              </button>
              <button
                type="button"
                className="room-confirm-yes"
                onClick={handleAcceptVideoRequest}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
      {transportError && <div className="room-error">{transportError}</div>}
    </div>
  );
}

function App() {
  const [createdRoom, setCreatedRoom] = useState(null);
  const [hostRoomTopic, setHostRoomTopic] = useState(() => getStoredHostRoomTopic());
  const [hiddenTopics, setHiddenTopics] = useState(() => new Set(readHiddenTopics()));
  const [kickedTopics, setKickedTopics] = useState(() => new Set(readKickedTopics()));
  const [locatedPosition, setLocatedPosition] = useState(null);
  const [searchedRooms, setSearchedRooms] = useState([]);
  const [isSearchingRooms, setIsSearchingRooms] = useState(false);
  const [scanResult, setScanResult] = useState('idle');
  const [isNoRoomVisible, setIsNoRoomVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [mapTheme, setMapTheme] = useState('light');
  const activeScanIdRef = useRef(0);
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const roomTopicFromUrl = searchParams.get('roomTopic');
  const roomRole = searchParams.get('role') === 'host' ? 'host' : 'guest';
  const usernameFromUrl = searchParams.get('username');
  const sessionExpiresAtParam = Number(searchParams.get('sessionExpiresAt'));
  const sessionExpiresAt = Number.isFinite(sessionExpiresAtParam) && sessionExpiresAtParam > 0
    ? sessionExpiresAtParam
    : Date.now() + DEFAULT_SESSION_MS;

  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [roomToJoin, setRoomToJoin] = useState(null);
  const [joinUsername, setJoinUsername] = useState('');
  const [activeChatRoom, setActiveChatRoom] = useState(null);
  const handleToggleMapTheme = useCallback(() => {
    setMapTheme(prevTheme => (prevTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  const hideRoomTopic = useCallback(topic => {
    if (!topic) {
      return;
    }
    setHiddenTopics(prev => {
      const next = new Set(prev);
      next.add(topic);
      writeHiddenTopics(next);
      return next;
    });
    setSearchedRooms(prev => prev.filter(room => room.topic !== topic));
    setCreatedRoom(prev => (prev?.topic === topic ? null : prev));
  }, []);

  const blockKickedTopic = useCallback(topic => {
    if (!topic) {
      return;
    }
    setKickedTopics(prev => {
      if (prev.has(topic)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(topic);
      writeKickedTopics(next);
      return next;
    });
    setSearchedRooms(prev => prev.filter(room => room.topic !== topic));
  }, []);

  // Initial Geolocation Request
  useEffect(() => {
    if (navigator.geolocation && !locatedPosition) {
      navigator.geolocation.getCurrentPosition(
        position => {
          setLocatedPosition({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            locatedAt: Date.now(),
          });
        },
        error => {
          // Silent failure is okay for initial auto-locate
          // We don't want to spam the user with modal errors on launch
          console.debug('Initial location request failed or denied:', error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  }, [locatedPosition]);

  useEffect(() => {
    if (!locatedPosition) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setLocatedPosition(null);
    }, 6000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [locatedPosition]);

  const handleCreateRoom = async roomData => {
    try {
      const countryDetails = await resolveCountryByCoordinates(roomData?.lat, roomData?.lng);
      const enrichedRoomData = {
        ...roomData,
        countryCode: countryDetails.countryCode,
        countryName: countryDetails.countryName,
      };
      const hostId = getOrCreateClientId();
      const response = await requestJson('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          message: roomData.message || '',
          hostId: buildHostIdPayload(hostId, enrichedRoomData),
        }),
      });
      const room = response?.room;
      if (!room?.topic) {
        throw new Error('Room creation failed.');
      }
      const expiresAt = parseExpiresAt(room.expiresAt);
      setCreatedRoom({ ...enrichedRoomData, topic: room.topic, sessionExpiresAt: expiresAt, availability: 'idle' });
      setHostRoomTopic(room.topic);
      setHiddenTopics(prev => {
        if (!prev.has(room.topic)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(room.topic);
        writeHiddenTopics(next);
        return next;
      });
      
      const activeRoomData = {
        topic: room.topic,
        role: 'host',
        sessionExpiresAt: expiresAt,
        username: roomData.username || '',
      };
      window.localStorage.setItem('pyaw-pyaw-active-room', JSON.stringify(activeRoomData));
      setActiveChatRoom(activeRoomData);
    } catch (error) {
      setModalMessage(error.message || 'Unable to create room.');
    }
  };

  const mapActiveRooms = useCallback(
    rooms =>
      (rooms || [])
        .map(room => {
          const metadata = readHostIdPayload(room.hostId);
          return {
            topic: room.topic,
            message: room.message || '',
            sessionExpiresAt: parseExpiresAt(room.expiresAt),
            lat: metadata?.lat,
            lng: metadata?.lng,
            gender: metadata?.gender || 'Male',
            username: metadata?.username || 'Anonymous',
            messageType: metadata?.messageType || 'Hi',
            countryCode: normalizeCountryCode(metadata?.countryCode),
            countryName: metadata?.countryName || getCountryName(metadata?.countryCode),
            availability: room.lastGuestId ? 'busy' : 'idle',
          };
        })
        .filter(
          room =>
            isFutureTimestamp(room.sessionExpiresAt) &&
            !hiddenTopics.has(room.topic) &&
            !kickedTopics.has(room.topic)
        ),
    [hiddenTopics, kickedTopics]
  );

  const refreshRoomsSilently = useCallback(async () => {
    const response = await requestJson('/api/rooms/active');
    const mappedRooms = mapActiveRooms(response?.rooms);
    setScanResult(mappedRooms.length > 0 ? 'found' : 'empty');
    setSearchedRooms(mappedRooms.filter(room => Number.isFinite(room.lat) && Number.isFinite(room.lng)));
    setCreatedRoom(prev => {
      if (!prev?.topic) {
        return prev;
      }
      const matchedRoom = mappedRooms.find(room => room.topic === prev.topic);
      if (!matchedRoom) {
        return prev;
      }
      if (prev.availability === matchedRoom.availability) {
        return prev;
      }
      return {
        ...prev,
        availability: matchedRoom.availability,
      };
    });
    return mappedRooms;
  }, [mapActiveRooms]);

  const handleSearchRooms = useCallback(async () => {
    const scanId = activeScanIdRef.current + 1;
    activeScanIdRef.current = scanId;
    const startedAt = Date.now();
    setScanResult('idle');
    setIsNoRoomVisible(false);
    setIsSearchingRooms(true);
    try {
      const response = await requestJson('/api/rooms/active');
      const mappedRooms = mapActiveRooms(response?.rooms);
      if (activeScanIdRef.current !== scanId) {
        return [];
      }
      const nextResult = mappedRooms.length > 0 ? 'found' : 'empty';
      setScanResult(nextResult);
      setIsNoRoomVisible(nextResult === 'empty');
      setSearchedRooms(mappedRooms.filter(room => Number.isFinite(room.lat) && Number.isFinite(room.lng)));
      return mappedRooms;
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SCAN_VISIBILITY_MS && activeScanIdRef.current === scanId) {
        await new Promise(resolve => window.setTimeout(resolve, MIN_SCAN_VISIBILITY_MS - elapsed));
      }
      if (activeScanIdRef.current === scanId) {
        setIsSearchingRooms(false);
      }
    }
  }, [mapActiveRooms]);

  const handleJoinRoom = async room => {
    if (!room?.topic || !room?.sessionExpiresAt) {
      return false;
    }
    if (kickedTopics.has(room.topic)) {
      setModalMessage('This host is not available for you now.');
      return false;
    }
    setRoomToJoin(room);
    setJoinUsername('');
    setJoinModalOpen(true);
    return true;
  };

  const handleOpenRoom = room => {
    const topic = room?.topic || createdRoom?.topic;
    if (!topic) {
      return false;
    }
    const expiresAt = parseExpiresAt(room?.sessionExpiresAt || createdRoom?.sessionExpiresAt);
    const username = room?.username || createdRoom?.username || '';
    setActiveChatRoom({
      topic,
      role: 'host',
      sessionExpiresAt: expiresAt,
      username,
    });
    return true;
  };

  const confirmJoinRoom = async () => {
    if (!roomToJoin || !joinUsername.trim()) {
      return;
    }
    const room = roomToJoin;
    if (kickedTopics.has(room.topic)) {
      setJoinModalOpen(false);
      setRoomToJoin(null);
      setModalMessage('This host is not available for you now.');
      return;
    }
    try {
      const response = await requestJson('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({
          topic: room.topic,
          guestId: getOrCreateClientId(),
        }),
      });
      const joinedRoom = response?.room;
      const expiresAt = parseExpiresAt(joinedRoom?.expiresAt || room.sessionExpiresAt);
      setActiveChatRoom({
        topic: room.topic,
        role: 'guest',
        sessionExpiresAt: expiresAt,
        username: joinUsername.trim(),
      });
      setJoinModalOpen(false);
      setRoomToJoin(null);
    } catch (error) {
      setModalMessage(error.message || 'Unable to join room.');
    }
  };

  const handleActiveRoomSessionUpdate = useCallback(sessionData => {
    const nextExpiresAt = parseExpiresAt(sessionData?.sessionExpiresAt);
    const topic = typeof sessionData?.topic === 'string' ? sessionData.topic : '';
    const role = sessionData?.role === 'host' ? 'host' : 'guest';
    const username = typeof sessionData?.username === 'string' ? sessionData.username : '';
    if (!topic || !Number.isFinite(nextExpiresAt) || nextExpiresAt <= Date.now()) {
      return;
    }
    setActiveChatRoom(prev => {
      if (!prev || prev.topic !== topic) {
        return prev;
      }
      return {
        ...prev,
        sessionExpiresAt: nextExpiresAt,
      };
    });
    setCreatedRoom(prev => {
      if (!prev || prev.topic !== topic) {
        return prev;
      }
      return {
        ...prev,
        sessionExpiresAt: nextExpiresAt,
      };
    });
    setSearchedRooms(prev =>
      prev.map(room => (room.topic === topic ? { ...room, sessionExpiresAt: nextExpiresAt } : room))
    );
    if (role === 'host') {
      setHostRoomTopic(topic);
      window.localStorage.setItem(
        'pyaw-pyaw-active-room',
        JSON.stringify({
          topic,
          role,
          sessionExpiresAt: nextExpiresAt,
          username,
        })
      );
    }
  }, []);

  const getExitMessage = useCallback(payload => {
    const role = payload?.role === 'host' ? 'host' : 'guest';
    if (payload?.kickedOut && role === 'guest') {
      return 'You were kicked out by host.';
    }
    if (payload?.terminatedByHost && role === 'guest') {
      return 'Host ended the room.';
    }
    if (payload?.expired && role === 'guest') {
      return 'Session expired. Please create or join a new room.';
    }
    return '';
  }, []);

  const handleExitChatRoom = useCallback(
    payload => {
      setActiveChatRoom(null);
      if (payload?.topic) {
        setCreatedRoom(prev => (prev?.topic === payload.topic ? null : prev));
        setHostRoomTopic(prev => (prev === payload.topic ? '' : prev));
        setSearchedRooms(prev => prev.filter(room => room.topic !== payload.topic || room.sessionExpiresAt > Date.now()));
      }
      if (payload?.role === 'host' || payload?.terminatedByHost) {
        window.localStorage.removeItem('pyaw-pyaw-active-room');
      }
      if (payload?.kickedOut) {
        if (payload?.topic) {
          blockKickedTopic(payload.topic);
        }
      }
      if (payload?.terminatedByHost) {
        hideRoomTopic(payload?.topic);
      }
      const exitMessage = getExitMessage(payload);
      if (exitMessage) {
        setModalMessage(exitMessage);
      }
      refreshRoomsSilently().catch(() => {});
    },
    [blockKickedTopic, getExitMessage, hideRoomTopic, refreshRoomsSilently]
  );

  const handleLocate = position => {
    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) {
      return;
    }
    setLocatedPosition(position);
  };

  const handleDismissNoRoom = () => {
    setIsNoRoomVisible(false);
  };

  const handleCancelScan = () => {
    activeScanIdRef.current += 1;
    setIsSearchingRooms(false);
    setScanResult('idle');
    setIsNoRoomVisible(false);
  };

  useEffect(() => {
    const handleRoomExitMessage = event => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type !== 'pyaw-pyaw-room-exit') {
        return;
      }
      setCreatedRoom(null);
      if (event.data?.kickedOut) {
        if (event.data?.topic) {
          blockKickedTopic(event.data.topic);
        }
      }
      if (event.data?.terminatedByHost) {
        hideRoomTopic(event.data?.topic);
        setHostRoomTopic('');
        window.localStorage.removeItem('pyaw-pyaw-active-room');
      }
      const exitMessage = getExitMessage(event.data);
      if (exitMessage) {
        setModalMessage(exitMessage);
      }
      if (event.data?.topic) {
        setActiveChatRoom(prev => (prev?.topic === event.data.topic ? null : prev));
      }
      refreshRoomsSilently().catch(() => {});
    };
    window.addEventListener('message', handleRoomExitMessage);
    return () => {
      window.removeEventListener('message', handleRoomExitMessage);
    };
  }, [blockKickedTopic, getExitMessage, hideRoomTopic, refreshRoomsSilently]);

  useEffect(() => {
    const handleStorage = event => {
      if (event.key !== ROOM_ACTIVITY_EVENT_KEY || !event.newValue) {
        return;
      }
      try {
        const payload = JSON.parse(event.newValue);
        if (payload?.type !== 'terminated') {
          return;
        }
        if (payload?.topic) {
          hideRoomTopic(payload.topic);
          setCreatedRoom(prev => (prev?.topic === payload.topic ? null : prev));
          setActiveChatRoom(prev => (prev?.topic === payload.topic ? null : prev));
        }
        setHostRoomTopic('');
        window.localStorage.removeItem('pyaw-pyaw-active-room');
        refreshRoomsSilently().catch(() => {});
      } catch {
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [hideRoomTopic, refreshRoomsSilently]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshRoomsSilently().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshRoomsSilently]);

  useEffect(() => {
    const pollTimer = window.setInterval(() => {
      refreshRoomsSilently().catch(() => {});
    }, 15000);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [refreshRoomsSilently]);

  useEffect(() => {
    const pruneTimer = window.setInterval(() => {
      const now = Date.now();
      setSearchedRooms(prev =>
        prev.filter(room => Number.isFinite(room?.sessionExpiresAt) && room.sessionExpiresAt > now)
      );
    }, 1000);
    return () => {
      window.clearInterval(pruneTimer);
    };
  }, []);

  useEffect(() => {
    if (!createdRoom) {
      return;
    }
    if (isFutureTimestamp(createdRoom.sessionExpiresAt)) {
      return;
    }
    setCreatedRoom(null);
    if (hostRoomTopic === createdRoom.topic) {
      setHostRoomTopic('');
    }
  }, [createdRoom, hostRoomTopic]);

  useEffect(() => {
    if (!activeChatRoom) {
      return;
    }
    if (isFutureTimestamp(activeChatRoom.sessionExpiresAt)) {
      return;
    }
    setActiveChatRoom(null);
    window.localStorage.removeItem('pyaw-pyaw-active-room');
    if (activeChatRoom.role === 'host') {
      setHostRoomTopic('');
    }
  }, [activeChatRoom]);

  useEffect(() => {
    let isDisposed = false;
    let reconnectTimer = null;
    let eventSource = null;

    const connectRealtime = () => {
      eventSource = new EventSource(`${apiBaseUrl}/api/rooms/stream`);
      eventSource.onmessage = () => {
        refreshRoomsSilently().catch(() => {});
      };
      eventSource.onerror = () => {
        eventSource?.close();
        if (isDisposed) {
          return;
        }
        reconnectTimer = window.setTimeout(connectRealtime, 2000);
      };
    };

    refreshRoomsSilently().catch(() => {});
    connectRealtime();

    return () => {
      isDisposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      eventSource?.close();
    };
  }, [refreshRoomsSilently]);

  if (roomTopicFromUrl) {
    return <RoomTab topic={roomTopicFromUrl} role={roomRole} sessionExpiresAt={sessionExpiresAt} username={usernameFromUrl} />;
  }

  return (
    <div className="App">
      <InfoModal message={modalMessage} onClose={() => setModalMessage('')} />
      <MapComponent
        createdRoom={createdRoom}
        hostRoomTopic={hostRoomTopic}
        locatedPosition={locatedPosition}
        searchedRooms={searchedRooms}
        isSearchingRooms={isSearchingRooms}
        onJoinRoom={handleJoinRoom}
        onOpenRoom={handleOpenRoom}
        showNoRoomFound={!isSearchingRooms && scanResult === 'empty' && isNoRoomVisible}
        onDismissNoRoom={handleDismissNoRoom}
        onCancelScan={handleCancelScan}
        mapTheme={mapTheme}
        onToggleMapTheme={handleToggleMapTheme}
        showThemeToggle={!activeChatRoom}
      />
      <MenuButton
        onCreateRoom={handleCreateRoom}
        onSearchRooms={handleSearchRooms}
        onJoinRoom={handleJoinRoom}
        onLocate={handleLocate}
        onResumeRoom={handleOpenRoom}
        mapTheme={mapTheme}
      />
      {joinModalOpen && (
        <div className="glass-modal-backdrop" onClick={() => setJoinModalOpen(false)}>
          <div className="glass-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header-row">
              <h3 className="modal-title">Join Room</h3>
            </div>
            <div className="manual-join-section">
              <input
                className="manual-join-input"
                value={joinUsername}
                onChange={event => setJoinUsername(event.target.value)}
                placeholder="Enter your username..."
              />
            </div>
            <div className="modal-action-row">
              <button
                type="button"
                className="modal-action-button cancel-button"
                onClick={() => setJoinModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-action-button create-button"
                onClick={confirmJoinRoom}
                disabled={!joinUsername.trim()}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
      {activeChatRoom && (
        <div className="room-overlay">
          <RoomTab
            topic={activeChatRoom.topic}
            role={activeChatRoom.role}
            sessionExpiresAt={activeChatRoom.sessionExpiresAt}
            username={activeChatRoom.username}
            onExit={handleExitChatRoom}
            onSessionExpiresAtChange={handleActiveRoomSessionUpdate}
          />
        </div>
      )}
    </div>
  );
}

export default App;
