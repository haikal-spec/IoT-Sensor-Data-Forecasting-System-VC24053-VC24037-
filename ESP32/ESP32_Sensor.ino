#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "haikal";
const char* password = "haikal140404";
const char* scriptURL = "https://script.google.com/macros/s/AKfycbwbSih2y9bjNBHqcjTrnzKJMYLmyTSbRNEUJLE2GRisZHtiaulPASzBZL-gz88WLMwJhw/exec";

#define DHTPIN 16
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

const unsigned long sendInterval = 600000;
unsigned long previousMillis = 0;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("ESP32 DHT11 Sensor Data Logger - PBL TSO2");

  dht.begin();

  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected!");

  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  previousMillis = millis() - sendInterval;
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= sendInterval) {
    previousMillis = currentMillis;

    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();

    if (isnan(humidity) || isnan(temperature) ||
        temperature < -40 || temperature > 80 ||
        humidity < 0 || humidity > 100) {
      Serial.println("Invalid sensor reading. Data not sent.");
      return;
    }

    Serial.println("---------------------------");

    Serial.print("Temperature: ");
    Serial.print(temperature);
    Serial.println(" °C");

    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");

    sendDataToGoogleSheets(temperature, humidity);
  }
}

void sendDataToGoogleSheets(float temperature, float humidity) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");

    WiFi.disconnect();
    WiFi.begin(ssid, password);

    unsigned long startTime = millis();

    while (WiFi.status() != WL_CONNECTED &&
           millis() - startTime < 10000) {
      delay(500);
      Serial.print(".");
    }
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nWiFi connection failed.");
    return;
  }

  StaticJsonDocument<200> doc;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;

  String jsonString;
  serializeJson(doc, jsonString);

  Serial.println("Sending data to Google Sheets...");
  Serial.println(jsonString);

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  const char* headerKeys[] = {"Location"};

  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  http.collectHeaders(headerKeys, 1);
  http.setTimeout(20000);

  if (!http.begin(client, scriptURL)) {
    Serial.println("HTTP connection failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  int responseCode = http.POST(jsonString);

  Serial.print("POST Response Code: ");
  Serial.println(responseCode);

  String redirectURL = http.header("Location");

  if (responseCode == 200) {
    Serial.println("Response:");
    Serial.println(http.getString());
    Serial.println("Data sent successfully.");
  }
  else if (responseCode == 301 ||
           responseCode == 302 ||
           responseCode == 303 ||
           responseCode == 307 ||
           responseCode == 308) {

    Serial.println("Redirect detected.");
    Serial.println(redirectURL);

    http.end();

    if (redirectURL.length() == 0) {
      Serial.println("Redirect URL not found.");
      return;
    }

    WiFiClientSecure redirectClient;
    redirectClient.setInsecure();

    HTTPClient redirectHttp;
    redirectHttp.setTimeout(20000);

    if (!redirectHttp.begin(redirectClient, redirectURL)) {
      Serial.println("Redirect connection failed.");
      return;
    }

    int getResponseCode = redirectHttp.GET();

    Serial.print("GET Response Code: ");
    Serial.println(getResponseCode);

    Serial.println("Final Response:");
    Serial.println(redirectHttp.getString());

    if (getResponseCode == 200) {
      Serial.println("Google Apps Script response received.");
    }

    redirectHttp.end();
    return;
  }
  else {
    Serial.println("POST failed.");
    Serial.println(http.getString());
  }

  http.end();
}
