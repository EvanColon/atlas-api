import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWorkoutPlan } from '@/lib/llmFunctions';
import { authMiddleware } from '@/middleware/auth';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: Request) {
  const authResponse = await authMiddleware(request);
  if (authResponse.status !== 200) return authResponse;

  let { id, startDate, endDate, userInput } = await request.json();

  // If the request has a given user id, use that, otherwise use the user from the token
  const user = (request as any).user;
  if (!id) {
    id = user.id;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', id)
    .single();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const workoutPlan = await generateWorkoutPlan(profile, userInput, startDate, endDate);

  try {
    // Save the workout plan in 3 tables: workout_plans, daily_workouts, exercises
    const { data: savedPlan, error } = await supabase
      .from('workout_plans')
      .insert({
        user_id: id,
        name: workoutPlan.name,
        start_date: workoutPlan.startDate,
        end_date: workoutPlan.endDate,
        goal: workoutPlan.workoutGoal,
      })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Save each daily workout
    for (const dailyWorkout of workoutPlan.workoutPlan) {
      const { data: savedDailyWorkout, error } = await supabase
        .from('daily_workouts')
        .insert({
          workout_plan_id: savedPlan[0].id,
          date: dailyWorkout.day,
          summary: dailyWorkout.summary,
          duration: dailyWorkout.duration,
          calories_burned: dailyWorkout.caloriesBurned,
          workout_type: dailyWorkout.workoutType,
        })
        .select();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Save each exercise
      for (const exercise of dailyWorkout.exercises) {
        const { data: savedExercise, error } = await supabase
          .from('exercises')
          .insert({
            daily_workout_id: savedDailyWorkout[0].id,
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            duration: exercise.duration,
            weight: exercise.weight,
            rest_time: exercise.restTime,
            completed: false,
            difficulty: exercise.exerciseDifficulty,
          })
          .select();

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json(savedPlan[0], { status: 201 });
  } catch (error) {
    console.error("Error saving workout plan:", error);
    return NextResponse.json({ error: `Error saving workout plan: ${error}` }, { status: 500 });
  }
}