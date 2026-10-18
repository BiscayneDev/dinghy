/**
 * Photon 2.0 (beta API, api.photon.codes/v1) server configuration.
 *
 * Fail-closed, mirroring src/lib/spectrum/config.ts: the v2 webhook route
 * must never process an unverified delivery, so a missing signing secret is
 * a hard error. All three values unset => v2 transport is simply off; the
 * route refuses to serve. This IS the rollout flag: production gets the env
 * vars only at cutover.
 */

export interface PhotonV2Config {
    projectId: string
    apiKey: string
    webhookSecret: string
    apiBase: string
}

export function getPhotonV2Config(env: NodeJS.ProcessEnv = process.env): PhotonV2Config {
    const projectId = env.PHOTON_V2_PROJECT_ID
    const apiKey = env.PHOTON_V2_API_KEY
    const webhookSecret = env.PHOTON_V2_WEBHOOK_SECRET
    if (!projectId || !apiKey) {
        throw new Error('PHOTON_V2_PROJECT_ID and PHOTON_V2_API_KEY are required')
    }
    if (!webhookSecret) {
        throw new Error('PHOTON_V2_WEBHOOK_SECRET is required (from the v2 webhook destination)')
    }
    return { projectId, apiKey, webhookSecret, apiBase: env.PHOTON_V2_API_BASE ?? 'https://api.photon.codes' }
}
