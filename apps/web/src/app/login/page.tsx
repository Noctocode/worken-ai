"use client";

import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function LoginPage() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat">
      <Card className="w-full max-w-[500px] mx-4 text-center p-8">
        <CardHeader>
          <div className="flex items-center justify-center">
            <Image
              src="/full-logo.png"
              alt="WorkenAI"
              width={128}
              height={17}
              priority
            />
          </div>
          <CardTitle className="text-[32px] font-bold leading-none text-text-1 py-1 mt-3">
            Welcome to WorkenAI
          </CardTitle>
          <CardDescription className="text-lg leading-tight font-normal text-text-2 py-1">
            Please enter your email and password to sign in or choose another
            option
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
            <Input
              type="email"
              placeholder="Email Address"
              className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
            />
          </div>
          <div className="relative mt-4">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
            <Input
              type="password"
              placeholder="Password"
              className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
            />
          </div>
          <Button
            className="w-full h-14 gap-2 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-md mt-4"
            size="lg"
          >
            <LogIn className="h-4 w-4" />
            Continue
          </Button>
          <div className="flex items-center gap-2 my-6">
            <div className="flex-1 h-0 border-t border-divider" />
            <span className="text-sm text-text-2">or continue with</span>
            <div className="flex-1 h-0 border-t border-divider" />
          </div>
          <Button
            variant="outline"
            className="w-full gap-2 h-14 text-base font-normal rounded-md border-border-3"
            size="lg"
            onClick={() => {
              window.location.href = `${API_URL}/auth/google`;
            }}
          >
            <svg className="h-4 w-4 text-text-1" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </Button>
          <p className="text-sm text-text-2 mt-6">
            {"Don't have an account? "}
            <Link href="/register" className="text-primary-6 hover:text-primary-7 font-medium">Sign up</Link>
            {" to create a workspace"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}