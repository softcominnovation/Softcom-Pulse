import axios from "axios";
import { installAuthInterceptors } from "./auth-interceptors";
import { getAuthController } from "@/store/auth.store";

export const api = axios.create({ baseURL: "/api", timeout: 8000 });
installAuthInterceptors(api, getAuthController);
