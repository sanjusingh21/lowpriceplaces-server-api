import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
  };
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access Denied: No Token Provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "fallbacksecret", (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Access Denied: Invalid Token" });
    }
    req.user = user;
    next();
  });
};
