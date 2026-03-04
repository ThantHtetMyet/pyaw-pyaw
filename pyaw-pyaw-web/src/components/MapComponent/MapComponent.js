import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function MapRecenter({ createdRoom, locatedPosition }) {
  const map = useMap();
  const targetPosition = useMemo(() => {
    const roomTime = createdRoom?.createdAt || 0;
    const locateTime = locatedPosition?.locatedAt || 0;
    if (!createdRoom && !locatedPosition) {
      return null;
    }
    if (locateTime >= roomTime && locatedPosition) {
      return [locatedPosition.lat, locatedPosition.lng];
    }
    return [createdRoom.lat, createdRoom.lng];
  }, [createdRoom, locatedPosition]);

  useEffect(() => {
    if (!targetPosition) {
      return;
    }
    map.flyTo(targetPosition, 16, { duration: 1.1 });
  }, [targetPosition, map]);

  return null;
}

function MapComponent({ createdRoom, locatedPosition }) {
  const defaultPosition = [51.505, -0.09];
  const markerIcon = useMemo(() => {
    if (!createdRoom) {
      return null;
    }
    const genderClass = createdRoom.gender === 'Female' ? 'female' : 'male';
    return L.divIcon({
      html: `<div class="user-hand-marker ${genderClass}"><div class="marker-pulse"></div><div class="marker-hand">☝</div></div>`,
      className: 'user-hand-marker-wrapper',
      iconSize: [56, 56],
      iconAnchor: [28, 52],
      popupAnchor: [0, -40],
    });
  }, [createdRoom]);
  const locateIcon = useMemo(
    () =>
      L.divIcon({
        html: '<div class="current-location-dot"></div>',
        className: 'current-location-wrapper',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    []
  );

  return (
    <MapContainer center={defaultPosition} zoom={13} style={{ height: '100vh', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapRecenter createdRoom={createdRoom} locatedPosition={locatedPosition} />
      {locatedPosition && (
        <Marker position={[locatedPosition.lat, locatedPosition.lng]} icon={locateIcon}>
          <Popup>Your current location</Popup>
        </Marker>
      )}
      {createdRoom && markerIcon && (
        <Marker position={[createdRoom.lat, createdRoom.lng]} icon={markerIcon}>
          <Popup>
            I am here
            {createdRoom.message ? ` - ${createdRoom.message}` : ''}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}

export default MapComponent;
