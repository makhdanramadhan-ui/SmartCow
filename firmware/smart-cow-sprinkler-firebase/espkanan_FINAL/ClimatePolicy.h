#pragma once
#include <math.h>
#include <stdint.h>

// Sama dengan js/core.js: T dari rata-rata 6 DS, RH dari rata-rata 4 DHT.
inline float aggregateThi(float temperature, float humidity) {
  if (!isfinite(temperature) || temperature < -55 || temperature > 125 ||
      !isfinite(humidity) || humidity < 0 || humidity > 100) return NAN;
  return (1.8f * temperature + 32.0f) -
    (0.55f - 0.0055f * humidity) * (1.8f * temperature - 26.0f);
}

enum class ClimateDecision { Stay, On, Off };
struct ClimateInput {
  float value, threshold, hysteresis;
  bool on, complete, scheduled, windowActive;
  uint32_t runSeconds, offSeconds, maxDuration, cooldown;
};
inline ClimateDecision climateDecision(const ClimateInput &s) {
  if (!s.complete || !isfinite(s.value)) return ClimateDecision::Off;
  if (s.scheduled && !s.windowActive) return ClimateDecision::Off;
  if (s.on && s.runSeconds >= s.maxDuration) return ClimateDecision::Off;
  if (!s.on && s.offSeconds < s.cooldown) return ClimateDecision::Stay;
  if (!s.on && s.value >= s.threshold) return ClimateDecision::On;
  if (s.on && s.value <= s.threshold - s.hysteresis) return ClimateDecision::Off;
  return ClimateDecision::Stay;
}
