"""Weather tool: get_weather using Open-Meteo API."""

import json
import urllib.request
import urllib.parse
import urllib.error

TOOL_DEFS = [
    {
        "name": "get_weather",
        "description": "Get current weather conditions for a location. Requires a city name or coordinates.",
        "input_schema": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name or location (e.g. 'San Francisco', 'London, UK')"
                }
            },
            "required": ["location"]
        }
    },
]

READ_ONLY = {"get_weather"}


async def _geocode_location(location: str) -> tuple[float, float, str] | None:
    """Convert location name to coordinates using Open-Meteo geocoding API."""
    try:
        params = urllib.parse.urlencode({"name": location, "count": 1, "language": "en", "format": "json"})
        url = f"https://geocoding-api.open-meteo.com/v1/search?{params}"
        
        req = urllib.request.Request(url, headers={"User-Agent": "Marty-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        if "results" in data and len(data["results"]) > 0:
            result = data["results"][0]
            lat = result["latitude"]
            lon = result["longitude"]
            name = result["name"]
            country = result.get("country", "")
            full_name = f"{name}, {country}" if country else name
            return (lat, lon, full_name)
        return None
    except Exception as e:
        print(f"Geocoding error: {e}")
        return None


async def handle_get_weather(input_data: dict) -> str:
    location = input_data["location"]
    
    # Geocode the location first
    geocode_result = await _geocode_location(location)
    if not geocode_result:
        return f"Could not find location: {location}"
    
    lat, lon, full_name = geocode_result
    
    try:
        # Fetch weather data from Open-Meteo API
        params = urllib.parse.urlencode({
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch"
        })
        url = f"https://api.open-meteo.com/v1/forecast?{params}"
        
        req = urllib.request.Request(url, headers={"User-Agent": "Marty-Agent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        current = data.get("current", {})
        
        # WMO Weather interpretation codes
        weather_codes = {
            0: "Clear sky",
            1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
            45: "Foggy", 48: "Depositing rime fog",
            51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
            61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
            71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
            77: "Snow grains",
            80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
            85: "Slight snow showers", 86: "Heavy snow showers",
            95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail"
        }
        
        temp = current.get("temperature_2m")
        feels_like = current.get("apparent_temperature")
        humidity = current.get("relative_humidity_2m")
        precipitation = current.get("precipitation")
        wind_speed = current.get("wind_speed_10m")
        weather_code = current.get("weather_code")
        conditions = weather_codes.get(weather_code, "Unknown")
        
        result = f"Weather for {full_name}:\n"
        result += f"Conditions: {conditions}\n"
        result += f"Temperature: {temp}°F (feels like {feels_like}°F)\n"
        result += f"Humidity: {humidity}%\n"
        result += f"Wind Speed: {wind_speed} mph\n"
        result += f"Precipitation: {precipitation} in"
        
        return result
        
    except urllib.error.URLError as e:
        return f"Error fetching weather data: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"


HANDLERS = {
    "get_weather": handle_get_weather,
}
