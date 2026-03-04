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
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Date.now() + DEFAULT_SESSION_MS;
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

function RoomTab({ topic, role, sessionExpiresAt, username, onExit }) {
  const [isPeerJoined, setIsPeerJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [showChatInterface, setShowChatInterface] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [transportError, setTransportError] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [isRoomKilled, setIsRoomKilled] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000))
  );
  const mqttClientRef = useRef(null);
  const clientIdRef = useRef(getOrCreateClientId());
  const hasSeenPeerRef = useRef(false);
  const messagesEndRef = useRef(null);
  const isExpired = remainingSeconds <= 0;
  const isChatLocked = isExpired || isRoomKilled;
  const isHostRole = role === 'host';

  const addMessage = (sender, text) => {
    if (!text) {
      return;
    }
    setMessages(prev => [...prev, { id: Date.now(), sender, text }]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, showChatInterface]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  const isWaiting = !isPeerJoined && !isExpired;

  useEffect(() => {
    if (!isWaiting && !isExpired && !showChatInterface) {
      const timer = window.setTimeout(() => {
        setShowChatInterface(true);
      }, 2500);
      return () => window.clearTimeout(timer);
    }
  }, [isWaiting, isExpired, showChatInterface]);

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
          clientId: clientIdRef.current,
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
          if (Date.now() >= sessionExpiresAt) {
            return;
          }

          const payloadText = messageBuffer.toString('utf8');
          let payload;
          try {
            payload = JSON.parse(payloadText);
          } catch (error) {
            payload = { text: payloadText };
          }

          const senderId = payload?.senderId || payload?.clientId;
          if (senderId && senderId === clientIdRef.current) {
            return;
          }

          if (messageTopic.endsWith('/presence')) {
            setIsPeerJoined(true);
            if (!hasSeenPeerRef.current && mqttClient.connected) {
              hasSeenPeerRef.current = true;
              mqttClient.publish(
                `${topic}/presence`,
                JSON.stringify({
                  type: 'join',
                  clientId: clientIdRef.current,
                  senderId: clientIdRef.current,
                  senderRole: role,
                  senderName: username,
                })
              );
            }
            return;
          }

          if (messageTopic.endsWith('/chat')) {
            if (payload?.type === 'kill') {
              setIsRoomKilled(true);
              setShowChatInterface(true);
              addMessage('System', payload?.text || 'Host ended this chat.');
              return;
            }
            const text = typeof payload?.text === 'string' ? payload.text : payloadText;
            setIsPeerJoined(true);
            const senderName = payload?.senderName || (payload?.senderRole === 'host' ? 'Host' : 'Guest');
            addMessage(senderName, text);
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
  }, [topic, role, sessionExpiresAt, username]);

  const handleSendMessage = () => {
    const messageText = inputValue.trim();
    if (!messageText || !mqttClientRef.current?.connected || isChatLocked) {
      return;
    }

    const payload = JSON.stringify({
      type: 'chat',
      senderId: clientIdRef.current,
      senderRole: role,
      senderName: username,
      text: messageText,
    });

    mqttClientRef.current.publish(`${topic}/chat`, payload);
    addMessage(username || (role === 'host' ? 'Host' : 'Guest'), messageText);
    setInputValue('');
  };

  const notifyMapAndClose = payload => {
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
  };

  const handleExitChat = async () => {
    const isHost = isHostRole;
    if (isHost && mqttClientRef.current?.connected) {
      mqttClientRef.current.publish(
        `${topic}/chat`,
        JSON.stringify({
          type: 'kill',
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
          text: 'Host killed this room.',
        })
      );
    } else if (mqttClientRef.current?.connected) {
      mqttClientRef.current.publish(
        `${topic}/presence`,
        JSON.stringify({
          type: 'leave',
          senderId: clientIdRef.current,
          senderRole: role,
          senderName: username,
        })
      );
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
    mqttClientRef.current?.end(true);
    const exitPayload = { refreshRooms: true, terminatedByHost: isHost, topic };
    if (typeof onExit === 'function') {
      onExit(exitPayload);
      return;
    }
    notifyMapAndClose(exitPayload);
  };

  const timerMinutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const timerSeconds = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <div className="room-tab-page">
      <div className="room-panel">
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
          <div className="chat-box">
            <div className="chat-messages">
              {messages.length === 0 && <div className="chat-empty">No messages yet.</div>}
              {messages.map(message => (
                <div key={message.id} className="chat-message-item">
                  <span className="chat-sender">{message.sender}:</span> {message.text}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                disabled={isChatLocked}
              />
              <button type="button" className="chat-send-button" onClick={handleSendMessage} disabled={isChatLocked}>
                Send
              </button>
            </div>
          </div>
        )}
        {transportError && <div className="room-error">{transportError}</div>}
      </div>
    </div>
  );
}

function App() {
  const [createdRoom, setCreatedRoom] = useState(null);
  const [hostRoomTopic, setHostRoomTopic] = useState(() => getStoredHostRoomTopic());
  const [hiddenTopics, setHiddenTopics] = useState(() => new Set(readHiddenTopics()));
  const [locatedPosition, setLocatedPosition] = useState(null);
  const [searchedRooms, setSearchedRooms] = useState([]);
  const [isSearchingRooms, setIsSearchingRooms] = useState(false);
  const [scanResult, setScanResult] = useState('idle');
  const [isNoRoomVisible, setIsNoRoomVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
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

  const handleCreateRoom = async roomData => {
    try {
      const hostId = getOrCreateClientId();
      const response = await requestJson('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          message: roomData.message || '',
          hostId: buildHostIdPayload(hostId, roomData),
        }),
      });
      const room = response?.room;
      if (!room?.topic) {
        throw new Error('Room creation failed.');
      }
      const expiresAt = parseExpiresAt(room.expiresAt);
      setCreatedRoom({ ...roomData, topic: room.topic, sessionExpiresAt: expiresAt, availability: 'idle' });
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
            availability: room.lastGuestId ? 'busy' : 'idle',
          };
        })
        .filter(room => !hiddenTopics.has(room.topic)),
    [hiddenTopics]
  );

  const refreshRoomsSilently = useCallback(async () => {
    const response = await requestJson('/api/rooms/active');
    const mappedRooms = mapActiveRooms(response?.rooms);
    setScanResult(mappedRooms.length > 0 ? 'found' : 'empty');
    setSearchedRooms(mappedRooms.filter(room => Number.isFinite(room.lat) && Number.isFinite(room.lng)));
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

  const handleExitChatRoom = useCallback(
    payload => {
      setActiveChatRoom(null);
      if (payload?.terminatedByHost) {
        hideRoomTopic(payload?.topic);
        setCreatedRoom(prev => (prev?.topic === payload?.topic ? null : prev));
        setHostRoomTopic('');
        window.localStorage.removeItem('pyaw-pyaw-active-room');
      }
      handleSearchRooms();
    },
    [handleSearchRooms, hideRoomTopic]
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
      if (event.data?.terminatedByHost) {
        hideRoomTopic(event.data?.topic);
        setHostRoomTopic('');
        window.localStorage.removeItem('pyaw-pyaw-active-room');
      }
      if (event.data?.topic) {
        setActiveChatRoom(prev => (prev?.topic === event.data.topic ? null : prev));
      }
      handleSearchRooms();
    };
    window.addEventListener('message', handleRoomExitMessage);
    return () => {
      window.removeEventListener('message', handleRoomExitMessage);
    };
  }, [handleSearchRooms, hideRoomTopic]);

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
        handleSearchRooms();
      } catch {
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [handleSearchRooms, hideRoomTopic]);

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
      />
      <MenuButton
        onCreateRoom={handleCreateRoom}
        onSearchRooms={handleSearchRooms}
        onJoinRoom={handleJoinRoom}
        onLocate={handleLocate}
        onResumeRoom={handleOpenRoom}
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
          />
        </div>
      )}
    </div>
  );
}

export default App;
