import type { TrackingMode } from '@/domain/models';

export function supportsReps(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight';
}

export function supportsSeconds(trackingMode?: TrackingMode) {
  return trackingMode === 'time' || trackingMode === 'time_weight';
}

export function supportsWeight(trackingMode?: TrackingMode) {
  return trackingMode === 'reps_weight' || trackingMode === 'time_weight';
}
