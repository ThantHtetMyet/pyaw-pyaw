import { useEffect, useMemo, useRef, useState } from 'react';
import MapComponent from './components/MapComponent/MapComponent';
import MenuButton from './components/MenuButton/MenuButton';

const ROOM_REGISTRY_KEY = 'pyaw-pyaw-active-rooms';

function buildRoomTopic() {
  return `room/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readActiveRooms() {
  const registryText = window.localStorage.getItem(ROOM_REGISTRY_KEY);
  if (!registryText) {
    return [];
  }

  try {
    const parsedRooms = JSON.parse(registryText);
    if (!Array.isArray(parsedRooms)) {
      return [];
    }
    const now = Date.now();
    return parsedRooms.filter(room => room && room.topic && room.sessionExpiresAt > now);
  } catch (error) {
    return [];
  }
}

function writeActiveRooms(rooms) {
  window.localStorage.setItem(ROOM_REGISTRY_KEY, JSON.stringify(rooms));
}

function upsertActiveRoom(newRoom) {
  const currentRooms = readActiveRooms();
  const nextRooms = [newRoom, ...currentRooms.filter(room => room.topic !== newRoom.topic)];
  writeActiveRooms(nextRooms);
}

function RoomTab({ topic, role, sessionExpiresAt }) {
  const [isPeerJoined, setIsPeerJoined] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [transportError, setTransportError] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000))
  );
  const channelRef = useRef(null);
  const clientIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const isExpired = remainingSeconds <= 0;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (!window.BroadcastChannel) {
      setTransportError('BroadcastChannel is not supported in this browser.');
      return undefined;
    }

    const channel = new BroadcastChannel(`pyaw-pyaw-room-${topic}`);
    channelRef.current = channel;

    channel.onmessage = event => {
      const payload = event.data;
      if (!payload || payload.senderId === clientIdRef.current) {
        return;
      }

      if (Date.now() >= sessionExpiresAt) {
        return;
      }

      if (payload.type === 'join-request' && role === 'host') {
        setIsPeerJoined(true);
        channel.postMessage({ type: 'join-ack', senderId: clientIdRef.current });
        return;
      }

      if (payload.type === 'join-ack') {
        setIsPeerJoined(true);
        return;
      }

      if (payload.type === 'chat-message') {
        setMessages(prevMessages => [
          ...prevMessages,
          { sender: payload.senderRole === 'host' ? 'Host' : 'Guest', text: payload.text },
        ]);
      }
    };

    if (role === 'guest') {
      channel.postMessage({ type: 'join-request', senderId: clientIdRef.current });
    }

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [topic, role, sessionExpiresAt]);

  const handleSendMessage = () => {
    const messageText = inputValue.trim();
    if (!messageText || !channelRef.current || isExpired) {
      return;
    }

    const payload = {
      type: 'chat-message',
      senderId: clientIdRef.current,
      senderRole: role,
      text: messageText,
    };

    channelRef.current.postMessage(payload);
    setMessages(prevMessages => [...prevMessages, { sender: role === 'host' ? 'Host' : 'Guest', text: messageText }]);
    setInputValue('');
  };

  const isWaiting = !isPeerJoined && !isExpired;
  const timerMinutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const timerSeconds = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <div className="room-tab-page">
      <div className="room-panel">
        <div className={`room-timer ${isExpired ? 'expired' : ''}`}>Session Time Left: {timerMinutes}:{timerSeconds}</div>
        {!isWaiting && !isExpired && (
          <>
            <h2 className="room-title">Room Topic</h2>
            <div className="room-topic">{topic}</div>
          </>
        )}
        {isExpired && <div className="room-status expired">Session expired. Please create a new room.</div>}
        {isWaiting && (
          <div className="room-waiting">
            <div className="room-waiting-icon">
              <span />
              <span />
              <span />
            </div>
            <div className="room-status">
              {role === 'host' ? 'Waiting for someone to join this room...' : 'Connecting to host...'}
            </div>
          </div>
        )}
        {!isWaiting && !isExpired && (
          <div className="chat-box">
            <div className="chat-messages">
              {messages.length === 0 && <div className="chat-empty">Connected. Start sending messages.</div>}
              {messages.map((message, index) => (
                <div key={`${message.sender}-${index}`} className="chat-message-item">
                  <span className="chat-sender">{message.sender}:</span> {message.text}
                </div>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
              />
              <button type="button" className="chat-send-button" onClick={handleSendMessage}>
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
  const [locatedPosition, setLocatedPosition] = useState(null);
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const roomTopicFromUrl = searchParams.get('roomTopic');
  const roomRole = searchParams.get('role') === 'host' ? 'host' : 'guest';
  const sessionExpiresAtParam = Number(searchParams.get('sessionExpiresAt'));
  const sessionExpiresAt = Number.isFinite(sessionExpiresAtParam) && sessionExpiresAtParam > 0
    ? sessionExpiresAtParam
    : Date.now() + 5 * 60 * 1000;

  const handleCreateRoom = roomData => {
    const topic = buildRoomTopic();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    upsertActiveRoom({
      topic,
      message: roomData.message || '',
      createdAt: Date.now(),
      sessionExpiresAt: expiresAt,
    });
    setCreatedRoom({ ...roomData, topic, sessionExpiresAt: expiresAt });
    const roomUrl = `${window.location.origin}${window.location.pathname}?roomTopic=${encodeURIComponent(
      topic
    )}&role=host&sessionExpiresAt=${expiresAt}`;
    window.open(roomUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSearchRooms = () => {
    const rooms = readActiveRooms();
    writeActiveRooms(rooms);
    return rooms;
  };

  const handleJoinRoom = room => {
    if (!room?.topic || !room?.sessionExpiresAt) {
      return;
    }
    const roomUrl = `${window.location.origin}${window.location.pathname}?roomTopic=${encodeURIComponent(
      room.topic
    )}&role=guest&sessionExpiresAt=${room.sessionExpiresAt}`;
    window.open(roomUrl, '_blank', 'noopener,noreferrer');
  };

  const handleLocate = position => {
    if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng)) {
      return;
    }
    setLocatedPosition(position);
  };

  if (roomTopicFromUrl) {
    return <RoomTab topic={roomTopicFromUrl} role={roomRole} sessionExpiresAt={sessionExpiresAt} />;
  }

  return (
    <div className="App">
      <MapComponent createdRoom={createdRoom} locatedPosition={locatedPosition} />
      <MenuButton
        onCreateRoom={handleCreateRoom}
        onSearchRooms={handleSearchRooms}
        onJoinRoom={handleJoinRoom}
        onLocate={handleLocate}
      />
    </div>
  );
}

export default App;
