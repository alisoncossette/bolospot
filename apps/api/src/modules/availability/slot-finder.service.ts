import { Injectable } from '@nestjs/common';
import { DateTime, Interval } from 'luxon';

/**
 * Represents a time slot with availability info
 */
export interface TimeSlot {
  startTime: Date;
  endTime: Date;
}

/**
 * Busy period from a participant's calendar
 */
export interface BusyPeriod extends TimeSlot {
  source: string; // GOOGLE, MICROSOFT, MANUAL, etc.
}

/**
 * Participant's availability data
 */
export interface ParticipantAvailability {
  participantId: string;
  email: string;
  busyPeriods: BusyPeriod[];
  timezone: string;
}

/**
 * A common slot where multiple participants are available
 */
export interface CommonSlot extends TimeSlot {
  score: number; // 0-1, higher = more participants available
  availableParticipantIds: string[];
  unavailableParticipantIds: string[];
  totalParticipants: number;
}

/**
 * Options for finding available slots
 */
export interface FindSlotsOptions {
  duration: number; // Duration in minutes
  dateRangeStart: Date;
  dateRangeEnd: Date;
  timezone: string;
  workingHoursOnly?: boolean;
  workingHoursStart?: number; // 0-23
  workingHoursEnd?: number; // 0-23
  workingDays?: number[]; // 0-6, Sunday = 0
  bufferBefore?: number; // Buffer before meeting in minutes
  bufferAfter?: number; // Buffer after meeting in minutes
  minParticipants?: number; // Minimum required participants
  slotIncrement?: number; // Increment for generating slots (default 15 min)
  limit?: number; // Max slots to return
}

@Injectable()
export class SlotFinderService {
  /**
   * Find common available slots across all participants
   */
  findCommonSlots(
    participantAvailabilities: ParticipantAvailability[],
    options: FindSlotsOptions,
  ): CommonSlot[] {
    const {
      duration,
      dateRangeStart,
      dateRangeEnd,
      timezone,
      workingHoursOnly = true,
      workingHoursStart = 9,
      workingHoursEnd = 17,
      workingDays = [1, 2, 3, 4, 5], // Mon-Fri
      bufferBefore = 0,
      bufferAfter = 0,
      minParticipants = participantAvailabilities.length,
      slotIncrement = 15,
      limit = 50,
    } = options;

    const totalDuration = duration + bufferBefore + bufferAfter;
    const commonSlots: CommonSlot[] = [];

    // Generate candidate slots at regular intervals
    let cursor = DateTime.fromJSDate(dateRangeStart, { zone: timezone });
    const end = DateTime.fromJSDate(dateRangeEnd, { zone: timezone });

    while (cursor < end && commonSlots.length < limit) {
      // Skip to next working day if needed
      if (workingHoursOnly) {
        const dayOfWeek = cursor.weekday % 7; // Luxon uses 1-7, convert to 0-6
        if (!workingDays.includes(dayOfWeek)) {
          cursor = cursor.plus({ days: 1 }).set({ hour: workingHoursStart, minute: 0, second: 0 });
          continue;
        }

        // Skip to working hours start if before
        if (cursor.hour < workingHoursStart) {
          cursor = cursor.set({ hour: workingHoursStart, minute: 0, second: 0 });
        }

        // Skip to next day if past working hours
        if (cursor.hour >= workingHoursEnd) {
          cursor = cursor.plus({ days: 1 }).set({ hour: workingHoursStart, minute: 0, second: 0 });
          continue;
        }
      }

      // Check if this slot would extend past working hours
      const slotEnd = cursor.plus({ minutes: totalDuration });
      if (workingHoursOnly && slotEnd.hour > workingHoursEnd) {
        cursor = cursor.plus({ days: 1 }).set({ hour: workingHoursStart, minute: 0, second: 0 });
        continue;
      }

      // Check if slot is within date range
      if (slotEnd > end) {
        break;
      }

      // Check availability for each participant
      const availableIds: string[] = [];
      const unavailableIds: string[] = [];

      for (const participant of participantAvailabilities) {
        const isAvailable = this.isParticipantAvailable(
          participant,
          cursor.toJSDate(),
          slotEnd.toJSDate(),
        );

        if (isAvailable) {
          availableIds.push(participant.participantId);
        } else {
          unavailableIds.push(participant.participantId);
        }
      }

      // Add slot if enough participants are available
      if (availableIds.length >= minParticipants) {
        // Calculate actual meeting time (excluding buffer)
        const meetingStart = cursor.plus({ minutes: bufferBefore });
        const meetingEnd = meetingStart.plus({ minutes: duration });

        commonSlots.push({
          startTime: meetingStart.toJSDate(),
          endTime: meetingEnd.toJSDate(),
          score: availableIds.length / participantAvailabilities.length,
          availableParticipantIds: availableIds,
          unavailableParticipantIds: unavailableIds,
          totalParticipants: participantAvailabilities.length,
        });
      }

      // Move to next slot
      cursor = cursor.plus({ minutes: slotIncrement });
    }

    // Sort by score (descending) then by time (ascending)
    return commonSlots.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.startTime.getTime() - b.startTime.getTime();
    });
  }

  /**
   * Check if a participant is available during a time window
   */
  private isParticipantAvailable(
    participant: ParticipantAvailability,
    start: Date,
    end: Date,
  ): boolean {
    const slotInterval = Interval.fromDateTimes(
      DateTime.fromJSDate(start),
      DateTime.fromJSDate(end),
    );

    for (const busy of participant.busyPeriods) {
      const busyInterval = Interval.fromDateTimes(
        DateTime.fromJSDate(busy.startTime),
        DateTime.fromJSDate(busy.endTime),
      );

      // Check if busy period overlaps with the slot
      if (slotInterval.overlaps(busyInterval)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Merge overlapping busy periods for a participant
   */
  mergeBusyPeriods(busyPeriods: BusyPeriod[]): BusyPeriod[] {
    if (busyPeriods.length === 0) return [];

    // Sort by start time
    const sorted = [...busyPeriods].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    const merged: BusyPeriod[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];

      // Check if current overlaps with or is adjacent to last
      if (current.startTime <= last.endTime) {
        // Extend the last period if current ends later
        if (current.endTime > last.endTime) {
          last.endTime = current.endTime;
        }
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Convert free slots to busy periods (inverse)
   * Useful when a provider returns availability instead of busy times
   */
  freeSlotsToBusyPeriods(
    freeSlots: TimeSlot[],
    dateRangeStart: Date,
    dateRangeEnd: Date,
    source: string,
  ): BusyPeriod[] {
    if (freeSlots.length === 0) {
      // If no free slots, the entire range is busy
      return [{ startTime: dateRangeStart, endTime: dateRangeEnd, source }];
    }

    const busyPeriods: BusyPeriod[] = [];
    const sortedFree = [...freeSlots].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    // Gap before first free slot
    if (sortedFree[0].startTime > dateRangeStart) {
      busyPeriods.push({
        startTime: dateRangeStart,
        endTime: sortedFree[0].startTime,
        source,
      });
    }

    // Gaps between free slots
    for (let i = 0; i < sortedFree.length - 1; i++) {
      const currentEnd = sortedFree[i].endTime;
      const nextStart = sortedFree[i + 1].startTime;

      if (nextStart > currentEnd) {
        busyPeriods.push({
          startTime: currentEnd,
          endTime: nextStart,
          source,
        });
      }
    }

    // Gap after last free slot
    const lastFree = sortedFree[sortedFree.length - 1];
    if (lastFree.endTime < dateRangeEnd) {
      busyPeriods.push({
        startTime: lastFree.endTime,
        endTime: dateRangeEnd,
        source,
      });
    }

    return busyPeriods;
  }
}
