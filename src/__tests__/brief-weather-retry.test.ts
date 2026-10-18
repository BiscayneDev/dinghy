import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc: async () => ({ data: 0, error: null }) }) }))
import { cardWeather } from '@/lib/weather/brief-weather'

afterEach(() => { vi.unstubAllGlobals() })

const forecastBody = {
    current: { temperature_2m: 84.2, weather_code: 2, wind_speed_10m: 9.1, wind_direction_10m: 90 },
    daily: { weather_code: [2], temperature_2m_max: [88.4], temperature_2m_min: [78.1], precipitation_probability_max: [20] },
}
const ok = (body: unknown) => ({ ok: true, json: async () => body })

describe('brief weather retry', () => {
    it('retries a stalled forecast and still builds the card weather', async () => {
        let calls = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls += 1
            if (calls === 1) throw new TypeError('fetch failed')
            return ok(forecastBody)
        }))
        const w = await cardWeather(25.7617, -80.1918, 'Miami')
        expect(calls).toBe(2)
        expect(w).toMatchObject({ place: 'miami', temp: 84, sky: 'partly cloudy', high: 88, low: 78, rain: 20 })
    })

    it('returns null only after every retry stalls', async () => {
        let calls = 0
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls += 1
            throw new TypeError('fetch failed')
        }))
        expect(await cardWeather(25.7617, -80.1918, 'Miami')).toBeNull()
        expect(calls).toBe(3)
    })
})
