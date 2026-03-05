// 天气服务模块
// 调用 wttr.in API 获取天气数据
// CommonJS 版本 - 用于主进程

const https = require('https');
const http = require('http');

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
  }

  // 设置位置
  setLocation(location) {
    this.location = location;
    this.cache = null; // 清除缓存
  }

  // 获取天气数据
  async getWeather(location = null) {
    const loc = location || this.location || '';

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
      console.error('[Weather] Failed to fetch:', error.message);

      // 返回缓存数据（即使过期）
      if (this.cache) {
        console.log('[Weather] Using expired cache');
        return this.cache;
      }

      // 返回默认数据
      return this.getDefaultWeather();
    }
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

  // 默认天气数据
  getDefaultWeather() {
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
      weatherDesc: '获取中...',
      weatherDescEn: '',
      observationTime: '',
      localTime: '',
      forecast: [],
      fetchedAt: 0,
      source: 'default'
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
