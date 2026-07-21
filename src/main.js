import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "./styles/style.css";
import { applyBrandTheme, getSavedBrandTheme } from "./services/appSettings";

applyBrandTheme(getSavedBrandTheme())

const app = createApp(App)
app.use(router)
app.mount("#app");

