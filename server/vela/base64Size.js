export const decodedBase64ByteLengthFromShape = (payloadLength, paddingLength = 0) => {
  if (!Number.isSafeInteger(payloadLength) || payloadLength <= 0) return 0;
  if (!Number.isInteger(paddingLength) || paddingLength < 0 || paddingLength > 2) return 0;
  return Math.max(0, Math.floor((payloadLength * 3) / 4) - paddingLength);
};

export const decodedBase64ByteLength = (payload) => {
  const value = String(payload || '');
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return decodedBase64ByteLengthFromShape(value.length, paddingLength);
};
