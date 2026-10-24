const { BlockList, isIP } = require("node:net");

const IPV4_RESERVED_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.31.196.0", 24],
  ["192.52.193.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["192.175.48.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

const IPV6_RESERVED_RANGES = [
  ["2001::", 23],
  ["2001:4:112::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
];

const ipv4Reserved = new BlockList();
for (const [subnet, prefix] of IPV4_RESERVED_RANGES) {
  ipv4Reserved.addSubnet(subnet, prefix, "ipv4");
}

const ipv6Reserved = new BlockList();
ipv6Reserved.addSubnet("2000::", 3, "ipv6");
const ipv6Excluded = new BlockList();
for (const [subnet, prefix] of IPV6_RESERVED_RANGES) {
  ipv6Excluded.addSubnet(subnet, prefix, "ipv6");
}

function normalizeIp(value) {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  if (ip.includes("%")) return null;

  const mappedIpv4 = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedIpv4 && isIP(mappedIpv4[1]) === 4) return mappedIpv4[1];
  return isIP(ip) ? ip : null;
}

function isPublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return false;

  if (isIP(ip) === 4) {
    return !ipv4Reserved.check(ip, "ipv4");
  }

  return ipv6Reserved.check(ip, "ipv6")
    && !ipv6Excluded.check(ip, "ipv6");
}

function emptyLocation(status) {
  return {
    country: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    provider: null,
    status
  };
}

function locationString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 150) : null;
}

function coordinate(value, minimum, maximum) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value >= minimum && value <= maximum ? value : undefined;
}

function normalizeLocation(data, provider) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const country = locationString(data.country);
  const region = locationString(data.region);
  const city = locationString(data.city);
  const latitude = coordinate(data.latitude, -90, 90);
  const longitude = coordinate(data.longitude, -180, 180);
  if (latitude === undefined || longitude === undefined) return null;
  if ((latitude === null) !== (longitude === null)) return null;
  if (!country && !region && !city && latitude === null) return null;

  return {
    country,
    region,
    city,
    latitude,
    longitude,
    provider,
    status: "success"
  };
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Provider returned a non-success status.");
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("GEOLOCATION_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function createGeolocationService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configuredTimeout = options.timeoutMs === undefined
    ? process.env.GEOLOCATION_TIMEOUT_MS
    : options.timeoutMs;
  const timeoutMs = positiveInteger(configuredTimeout, 1200);

  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  async function lookupProvider(ip, provider) {
    const response = await fetchJson(
      fetchImpl,
      provider.url(ip),
      timeoutMs
    );
    if (provider.isSuccess && !provider.isSuccess(response)) return null;
    return normalizeLocation(provider.map(response), provider.name);
  }

  const providers = [
    {
      name: "ipwho.is",
      url: (ip) => `https://ipwho.is/${encodeURIComponent(ip)}`,
      isSuccess: (data) => data?.success === true,
      map: (data) => ({
        country: data.country,
        region: data.region,
        city: data.city,
        latitude: data.latitude,
        longitude: data.longitude
      })
    },
    {
      name: "FreeIPAPI",
      url: (ip) => `https://free.freeipapi.com/api/v1/json/${encodeURIComponent(ip)}`,
      map: (data) => ({
        country: data.countryName,
        region: data.regionName,
        city: data.cityName,
        latitude: data.latitude,
        longitude: data.longitude
      })
    }
  ];

  return {
    async lookup(value) {
      const ip = normalizeIp(value);
      if (!ip || !isPublicIp(ip)) return emptyLocation("skipped");

      for (const provider of providers) {
        try {
          const location = await lookupProvider(ip, provider);
          if (location) return location;
        } catch {
          // Provider failures are intentionally isolated so the fallback runs.
        }
      }

      return emptyLocation("unavailable");
    }
  };
}

const defaultService = createGeolocationService();

module.exports = {
  createGeolocationService,
  emptyLocation,
  isPublicIp,
  normalizeIp,
  normalizeLocation,
  lookup: defaultService.lookup
};
