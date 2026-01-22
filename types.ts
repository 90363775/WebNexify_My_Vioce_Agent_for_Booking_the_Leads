export interface AudioConfig {
  sampleRate: number;
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error'
}

export interface MessageLog {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
}