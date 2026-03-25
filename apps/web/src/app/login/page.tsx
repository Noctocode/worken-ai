"use client";

import Image from "next/image";
import { User, Mail, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function LoginPage() {
  return (
    <div
      className="flex h-screen w-full items-center justify-center"
      style={{
        backgroundImage: "url('/login-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <Card className="w-full max-w-[500px] text-center border-2 border-blue-400 border-dashed py-10 px-8">
        <CardHeader className="space-y-4 pb-2">
          <div className="flex items-center justify-center">
            <Image
              src="/logo-full.png"
              alt="WorkenAI"
              width={128}
              height={17}
              priority
            />
          </div>
          <div>
            <h1 className="text-[32px] font-bold text-slate-900">
              Welcome to WorkenAI
            </h1>
            <p className="text-[18px] leading-[130%] text-[#4E5969] mt-2">
              Please enter your email to sign in or choose another option
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
            <Input
              type="text"
              placeholder="Full Name"
              className="pl-10 h-12 rounded-lg border-slate-200 text-[16px] font-normal placeholder:text-text-3"
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
            <Input
              type="email"
              placeholder="Email Address"
              className="pl-10 h-12 rounded-lg border-slate-200 text-[16px] font-normal placeholder:text-text-3"
            />
          </div>
          <Button
            className="w-full h-12 gap-2 bg-primary-6 hover:bg-primary-6/90 text-white rounded-lg text-base font-medium"
            size="lg"
          >
            <LogIn className="h-4 w-4" />
            Continue
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[14px] normal-case">
              <span className="bg-white px-3 text-[#4E5969] font-normal">
                or continue with
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full h-12 gap-3 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50"
            size="lg"
            onClick={() => {
              window.location.href = `${API_URL}/auth/google`;
            }}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google
          </Button>

          <p className="text-sm text-slate-500 mt-6">
            Already using WorkenAI?{" "}
            <a href="/login" className="text-sky-500 hover:underline font-medium">
              Sign in
            </a>{" "}
            to existing workspace
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
