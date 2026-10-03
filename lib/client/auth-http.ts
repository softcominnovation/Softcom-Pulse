import axios from "axios";

export const authHttp = axios.create({ baseURL: "/api/auth", timeout: 15_000 });
