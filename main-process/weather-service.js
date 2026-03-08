// 天气服务模块
// 调用 wttr.in API 获取天气数据
// CommonJS 版本 - 用于主进程

const https = require('https');
const http = require('http');
const { URL } = require('url');

class WeatherService {
  constructor() {
    // wttr.in 是免费的天气 API，无需 API Key
    this.baseUrl = 'wttr.in';
    this.cache = null;
    this.cacheTime = 0;
    this.cacheDuration = 60 * 60 * 1000; // 1 小时缓存

    // 默认位置（自动检测）
    this.location = null;

    // 天气代码到图标映射
    this.weatherIcons = {
      '113': '☀️', // Sunny
      '116': '⛅', // Partly cloudy
      '119': '☁️', // Cloudy
      '122': '☁️', // Overcast
      '143': '🌫️', // Mist
      '176': '🌧️', // Patchy rain
      '179': '🌨️', // Patchy snow
      '182': '🌨️', // Patchy sleet
      '185': '🌨️', // Patchy freezing drizzle
      '200': '⛈️', // Thundery outbreaks
      '227': '❄️', // Blowing snow
      '230': '❄️', // Blizzard
      '248': '🌫️', // Fog
      '260': '🌫️', // Freezing fog
      '263': '🌧️', // Patchy light drizzle
      '266': '🌧️', // Light drizzle
      '281': '🌧️', // Freezing drizzle
      '284': '🌧️', // Heavy freezing drizzle
      '293': '🌧️', // Patchy light rain
      '296': '🌧️', // Light rain
      '299': '🌧️', // Moderate rain
      '302': '🌧️', // Heavy rain
      '305': '🌧️', // Heavy rain
      '308': '🌧️', // Heavy rain
      '311': '🌧️', // Freezing rain
      '314': '🌧️', // Heavy freezing rain
      '317': '🌨️', // Sleet
      '320': '🌨️', // Heavy sleet
      '323': '🌨️', // Patchy snow
      '326': '🌨️', // Light snow
      '329': '🌨️', // Moderate snow
      '332': '🌨️', // Heavy snow
      '335': '🌨️', // Heavy snow
      '338': '🌨️', // Heavy snow
      '350': '🧊', // Ice pellets
      '353': '🌧️', // Rain shower
      '356': '🌧️', // Heavy rain shower
      '359': '🌧️', // Torrential rain
      '362': '🌨️', // Sleet showers
      '365': '🌨️', // Heavy sleet showers
      '368': '🌨️', // Snow showers
      '371': '🌨️', // Heavy snow showers
      '374': '🧊', // Ice pellets
      '377': '🧊', // Heavy ice pellets
      '386': '⛈️', // Patchy rain with thunder
      '389': '⛈️', // Heavy rain with thunder
      '392': '⛈️', // Patchy snow with thunder
      '395': '⛈️'  // Heavy snow with thunder
    };

    // 天气代码到描述映射
    this.weatherDescriptions = {
      '113': '晴天',
      '116': '多云',
      '119': '阴天',
      '122': '阴天',
      '143': '薄雾',
      '176': '小雨',
      '179': '小雪',
      '182': '雨夹雪',
      '200': '雷阵雨',
      '227': '风雪',
      '230': '暴风雪',
      '248': '雾',
      '260': '冻雾',
      '263': '微雨',
      '266': '小雨',
      '281': '冻雨',
      '293': '小雨',
      '296': '小雨',
      '299': '中雨',
      '302': '大雨',
      '305': '大雨',
      '308': '暴雨',
      '311': '冻雨',
      '317': '雨夹雪',
      '320': '雨夹雪',
      '323': '小雪',
      '326': '小雪',
      '329': '中雪',
      '332': '大雪',
      '335': '大雪',
      '338': '大雪',
      '350': '冰雹',
      '353': '阵雨',
      '356': '大雨',
      '359': '暴雨',
      '362': '雨夹雪',
      '365': '雨夹雪',
      '368': '阵雪',
      '371': '大雪',
      '374': '冰雹',
      '377': '冰雹',
      '386': '雷阵雨',
      '389': '雷雨',
      '392': '雷雪',
      '395': '雷雪'
    };

    this.openMeteoDescriptions = {
      0: '晴天',
      1: '基本晴',
      2: '局部多云',
      3: '阴天',
      45: '雾',
      48: '冻雾',
      51: '小毛毛雨',
      53: '毛毛雨',
      55: '强毛毛雨',
      56: '冻毛毛雨',
      57: '强冻毛毛雨',
      61: '小雨',
      63: '中雨',
      65: '大雨',
      66: '冻雨',
      67: '强冻雨',
      71: '小雪',
      73: '中雪',
      75: '大雪',
      77: '雪粒',
      80: '小阵雨',
      81: '阵雨',
      82: '强阵雨',
      85: '阵雪',
      86: '强阵雪',
      95: '雷暴',
      96: '雷暴冰雹',
      99: '强雷暴冰雹'
    };
    this.openMeteoIcons = {
      0: '☀️',
      1: '🌤️',
      2: '⛅',
      3: '☁️',
      45: '🌫️',
      48: '🌫️',
      51: '🌦️',
      53: '🌦️',
      55: '🌧️',
      56: '🌧️',
      57: '🌧️',
      61: '🌧️',
      63: '🌧️',
      65: '🌧️',
      66: '🌧️',
      67: '🌧️',
      71: '🌨️',
      73: '🌨️',
      75: '❄️',
      77: '❄️',
      80: '🌦️',
      81: '🌧️',
      82: '🌧️',
      85: '🌨️',
      86: '❄️',
      95: '⛈️',
      96: '⛈️',
      99: '⛈️'
    };
  }

  // 设置位置
  setLocation(location) {
    this.location = location;
    this.cache = null; // 清除缓存
  }

  setPreferredCity(city) {
    this.setLocation(city || null);
  }

  // 记住用户主动指定的城市（优先级高于 IP 定位）
  setPreferredCity(city) {
    if (city && typeof city === 'string' && city.trim()) {
      this.preferredCity = city.trim();
      console.log(`[Weather] 用户指定城市已记住: ${this.preferredCity}`);
    }
  }

  // 获取天气数据
  async getWeather(location = null) {
    // 用户明确指定城市 → 同时更新 preferredCity 作为下次默认
    if (location && location.trim()) {
      this.preferredCity = location.trim();
    }
    // 优先级：本次指定城市 > 用户历史指定城市 > 传入 this.location > IP 自动定位
    const loc = location || this.preferredCity || this.location || '';

    // 检查缓存
    if (this.cache && (Date.now() - this.cacheTime) < this.cacheDuration) {
      console.log('[Weather] Using cached data');
      return this.cache;
    }

    try {
      const data = await this.fetchWeather(loc);
      this.cache = data;
      this.cacheTime = Date.now();
      return data;
    } catch (error) {
      console.error('[Weather] Primary source failed:', error.message);
    }

    try {
      const fallbackData = await this.fetchWeatherFromOpenMeteo(loc);
      this.cache = fallbackData;
      this.cacheTime = Date.now();
      return fallbackData;
    } catch (error) {
      console.error('[Weather] Fallback source failed:', error.message);
    }

    if (this.cache) {
      console.log('[Weather] Using expired cache');
      return this.cache;
    }

    return this.getDefaultWeather('天气服务暂时不可用');
  }

  // 从 wttr.in 获取天气
  fetchWeather(location) {
    return new Promise((resolve, reject) => {
      const path = location
        ? `/${encodeURIComponent(location)}?format=j1`
        : '/?format=j1';

      const options = {
        hostname: this.baseUrl,
        path: path,
        method: 'GET',
        headers: {
          'User-Agent': 'curl', // wttr.in 需要
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }

            const json = JSON.parse(data);
            const weather = this.parseWeatherData(json);
            resolve(weather);
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  async fetchWeatherFromOpenMeteo(location) {
    const resolvedLocation = location
      ? await this.geocodeLocation(location)
      : await this.detectLocation();

    if (!resolvedLocation || !Number.isFinite(resolvedLocation.latitude) || !Number.isFinite(resolvedLocation.longitude)) {
      throw new Error('无法解析天气位置');
    }

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
    forecastUrl.searchParams.set('latitude', String(resolvedLocation.latitude));
    forecastUrl.searchParams.set('longitude', String(resolvedLocation.longitude));
    forecastUrl.searchParams.set('current_weather', 'true');
    forecastUrl.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min');
    forecastUrl.searchParams.set('timezone', 'auto');

    const data = await this.fetchJson(forecastUrl.toString());
    return this.parseOpenMeteoData(data, resolvedLocation);
  }

  async geocodeLocation(location) {
    const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
    geocodeUrl.searchParams.set('name', location);
    geocodeUrl.searchParams.set('count', '10'); // 多取几个候选，再从里面选最重要的
    geocodeUrl.searchParams.set('language', 'zh');
    geocodeUrl.searchParams.set('format', 'json');

    const data = await this.fetchJson(geocodeUrl.toString());
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) {
      throw new Error(`未找到位置: ${location}`);
    }

    // 优先选择行政中心类别（首都 PPLC > 省会 PPLA > 市 PPLA2 > 普通聚居地 PPL）
    const PRIORITY = { PPLC: 0, PPLA: 1, PPLA2: 2, PPLA3: 3, PPL: 4 };
    const sorted = results.slice().sort((a, b) => {
      const pa = PRIORITY[a.feature_code] ?? 5;
      const pb = PRIORITY[b.feature_code] ?? 5;
      if (pa !== pb) return pa - pb;
      // 同级别时按人口降序
      return (Number(b.population) || 0) - (Number(a.population) || 0);
    });

    const result = sorted[0];
    return {
      location: result.name || location,
      country: result.country || '',
      latitude: Number(result.latitude),
      longitude: Number(result.longitude)
    };
  }

  async detectLocation() {
    // 依次尝试多个 IP 定位服务，提高在中国网络环境下的可用性
    const providers = [
      {
        url: 'http://ip-api.com/json/?fields=status,city,regionName,country,lat,lon',
        parse: (d) => d.status === 'success' ? {
          location: d.city || d.regionName || '当前位置',
          country: d.country || '',
          latitude: Number(d.lat),
          longitude: Number(d.lon)
        } : null
      },
      {
        url: 'https://ipwho.is/',
        parse: (d) => d.success !== false ? {
          location: d.city || d.region || '当前位置',
          country: d.country || '',
          latitude: Number(d.latitude),
          longitude: Number(d.longitude)
        } : null
      },
      {
        url: 'https://ipapi.co/json/',
        parse: (d) => d.city ? {
          location: d.city || d.region || '当前位置',
          country: d.country_name || '',
          latitude: Number(d.latitude),
          longitude: Number(d.longitude)
        } : null
      }
    ];

    const errors = [];
    for (const provider of providers) {
      try {
        const data = await this.fetchJson(provider.url, 8000);
        const result = provider.parse(data);
        if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) {
          return result;
        }
      } catch (e) {
        errors.push(e.message);
      }
    }

    throw new Error(`自动定位失败: ${errors.join(' / ')}`);
  }

  fetchJson(inputUrl, timeoutMs = 10000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
      const url = new URL(inputUrl);
      const transport = url.protocol === 'http:' ? http : https;
      const req = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectCount >= 3) {
            reject(new Error('Too many redirects'));
            return;
          }
          const redirectedUrl = new URL(res.headers.location, url).toString();
          resolve(this.fetchJson(redirectedUrl, timeoutMs, redirectCount + 1));
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  // 解析天气数据
  parseWeatherData(data) {
    try {
      const current = data.current_condition?.[0] || {};
      const location = data.nearest_area?.[0] || {};
      const weatherCode = current.weatherCode || '113';

      return {
        // 位置
        location: location.areaName?.[0]?.value || location.region?.[0]?.value || '未知位置',
        country: location.country?.[0]?.value || '',

        // 当前天气
        temperature: parseInt(current.temp_C, 10) || 0,
        feelsLike: parseInt(current.FeelsLikeC, 10) || 0,
        humidity: parseInt(current.humidity, 10) || 0,
        windSpeed: parseInt(current.windspeedKmph, 10) || 0,
        windDir: current.winddir16Point || 'N',
        pressure: parseInt(current.pressure, 10) || 0,
        visibility: parseInt(current.visibility, 10) || 0,
        uvIndex: parseInt(current.uvIndex, 10) || 0,

        // 天气描述
        weatherCode: weatherCode,
        weatherIcon: this.weatherIcons[weatherCode] || '🌡️',
        weatherDesc: this.weatherDescriptions[weatherCode] || current.weatherDesc?.[0]?.value || '未知',
        weatherDescEn: current.weatherDesc?.[0]?.value || '',

        // 时间
        observationTime: current.observation_time || '',
        localTime: data.weather?.[0]?.date || '',

        // 预报（未来3天）
        forecast: (data.weather || []).slice(0, 3).map(day => ({
          date: day.date || '',
          maxTemp: parseInt(day.maxtempC, 10) || 0,
          minTemp: parseInt(day.mintempC, 10) || 0,
          avgTemp: parseInt(day.avgtempC, 10) || 0,
          weatherIcon: this.weatherIcons[day.hourly?.[4]?.weatherCode || '113'] || '🌡️',
          weatherDesc: this.weatherDescriptions[day.hourly?.[4]?.weatherCode || '113'] || ''
        })),

        // 元数据
        fetchedAt: Date.now(),
        source: 'wttr.in'
      };
    } catch (error) {
      console.error('[Weather] Failed to parse data:', error);
      return this.getDefaultWeather();
    }
  }

  parseOpenMeteoData(data, resolvedLocation) {
    const current = data.current_weather || {};
    const daily = data.daily || {};
    const currentCode = Number(current.weathercode || 0);

    return {
      location: resolvedLocation.location || '未知位置',
      country: resolvedLocation.country || '',
      temperature: Math.round(Number(current.temperature) || 0),
      feelsLike: Math.round(Number(current.temperature) || 0),
      humidity: 0,
      windSpeed: Math.round(Number(current.windspeed) || 0),
      windDir: current.winddirection || 'N',
      pressure: 0,
      visibility: 0,
      uvIndex: 0,
      weatherCode: String(currentCode),
      weatherIcon: this.openMeteoIcons[currentCode] || '🌡️',
      weatherDesc: this.openMeteoDescriptions[currentCode] || '未知',
      weatherDescEn: '',
      observationTime: current.time || '',
      localTime: current.time || '',
      forecast: (daily.time || []).slice(0, 3).map((date, index) => {
        const code = Number((daily.weathercode || [])[index] || 0);
        return {
          date,
          maxTemp: Math.round(Number((daily.temperature_2m_max || [])[index]) || 0),
          minTemp: Math.round(Number((daily.temperature_2m_min || [])[index]) || 0),
          avgTemp: Math.round((
            (Number((daily.temperature_2m_max || [])[index]) || 0) +
            (Number((daily.temperature_2m_min || [])[index]) || 0)
          ) / 2),
          weatherIcon: this.openMeteoIcons[code] || '🌡️',
          weatherDesc: this.openMeteoDescriptions[code] || '未知'
        };
      }),
      fetchedAt: Date.now(),
      source: 'open-meteo'
    };
  }

  // 默认天气数据
  getDefaultWeather(errorMessage = '获取中...') {
    return {
      location: '未获取',
      country: '',
      temperature: 0,
      feelsLike: 0,
      humidity: 0,
      windSpeed: 0,
      windDir: 'N',
      pressure: 0,
      visibility: 0,
      uvIndex: 0,
      weatherCode: '113',
      weatherIcon: '🌡️',
      weatherDesc: errorMessage,
      weatherDescEn: '',
      observationTime: '',
      localTime: '',
      forecast: [],
      fetchedAt: 0,
      source: 'default',
      unavailable: true
    };
  }

  // 获取天气图标
  getWeatherIcon(code) {
    return this.weatherIcons[code] || '🌡️';
  }

  // 获取天气描述
  getWeatherDesc(code) {
    return this.weatherDescriptions[code] || '未知';
  }
}

module.exports = WeatherService;
