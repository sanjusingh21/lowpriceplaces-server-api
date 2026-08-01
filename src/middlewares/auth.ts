import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
    [key: string]: any;
  };
}

export const JWT_SECRET =
  process.env.JWT_SECRET || "super_secret_lowpriceplaces_token_key_777_888";

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access Denied: No Token Provided" });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: "Access Denied: Invalid Token" });
    }
    req.user = user;
    next();
  });
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Access Denied: No Token Provided" });
    }

    const rawRole = (req.user.role || "USER").toString().trim().toUpperCase();
    const upperAllowed = allowedRoles.map((role) => role.toString().trim().toUpperCase());

    // If allowedRoles includes "USER", ANY authenticated user (USER, SELLER, BUYER, ADMIN, EDITOR, SEO) is allowed
    if (upperAllowed.includes("USER")) {
      return next();
    }

    // Check case-insensitive role match or superuser ADMIN access
    const hasRole = upperAllowed.includes(rawRole) || rawRole === "ADMIN";
    if (!hasRole) {
      return res.status(403).json({
        error: `Forbidden: Restricted to ${allowedRoles.join(", ")} roles.`,
      });
    }
    next();
  };
};
