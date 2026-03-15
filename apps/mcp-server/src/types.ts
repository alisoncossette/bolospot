// API response types matching the NestJS controllers

export interface WidgetAccess {
  widget: string;
  name: string;
  icon: string;
  status: 'granted' | 'no_access';
  scopes: string[];
  expiresAt: string | null;
}

export interface AccessCheckResponse {
  handle: string;
  exists: boolean;
  name?: string;
  verified?: boolean;
  humanVerified?: boolean;
  verificationLevel?: string;
  widgets: WidgetAccess[];
  pendingRequests: Array<{
    id: string;
    widget: string;
    scopes: string[];
    status: string;
    createdAt: string;
  }>;
}

export interface HandleExistsResponse {
  handle: string;
  exists: boolean;
  claimUrl?: string;
}

export interface AccessRequestResponse {
  success: boolean;
  requestId?: string;
  message: string;
  widget?: string;
  scopes?: string[];
}

export interface Widget {
  slug: string;
  name: string;
  description: string;
  icon: string;
  scopes: string[];
}

export interface BookingTierResponse {
  tier: 'direct' | 'approval' | 'blocked';
  reason: string;
}

export interface BusyPeriod {
  startTime: string;
  endTime: string;
  source?: string;
}

export interface AvailabilityResponse {
  busyPeriods: BusyPeriod[];
  timezone: string;
}

export interface MutualSlot {
  start: string;
  end: string;
}

export interface MutualAvailabilityResponse {
  mutualSlots: MutualSlot[];
  timezone: string;
}

export interface BookingProfile {
  handle: string;
  name: string;
  timezone: string;
  isHumanVerified: boolean;
  verificationLevel: string;
  workingHoursStart?: number;
  workingHoursEnd?: number;
  workingDays?: number[];
  bookingProfile?: {
    slug: string;
    name: string;
    description: string;
    durations: number[];
    bufferBefore: number;
    bufferAfter: number;
  };
}

export interface TimeSlot {
  time: string;
  available: boolean;
}

export interface AvailableSlotsResponse {
  date: string;
  duration: number;
  timezone: string;
  slots: TimeSlot[];
}

export interface BookingResponse {
  id: string;
  status: 'CONFIRMED' | 'PENDING_APPROVAL';
  startTime: string;
  endTime: string;
  duration: number;
  meetingLink?: string;
  message?: string;
}

// MCP tool definition shape
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// MCP tool handler
export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;
